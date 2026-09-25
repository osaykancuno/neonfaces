// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonPayout} from "../src/NeonPayout.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonSeedVault, ISeedTrader} from "../src/NeonSeedVault.sol";
import {PublicDrop} from "../src/interfaces/ISeaDrop.sol";
import {MockSeedTrader} from "./mocks/MockSeedTrader.sol";

/// @notice The mint funds its own seeds: no inventory before the sale, the seed share buys it.
contract SeedVaultTest is Base {
    NeonSeedVault vault;
    NeonPayout vaultPayout;
    MockSeedTrader trader;
    address keeper = makeAddr("keeper");
    address weth = makeAddr("weth");

    function setUp() public override {
        super.setUp();
        // the deploy order: vault -> payout (seed share = vault) -> collection -> seeder, then wire
        vault = new NeonSeedVault(treasury, admin);
        vaultPayout = new NeonPayout(payable(address(vault)), treasury, payable(address(teamVesting)), growth);
        faces = new NeonFaces(admin, royaltyReceiver, address(vaultPayout), SEADROP, "", "");
        seeder = new NeonSeeder(faces, registry, address(accountImpl), admin);
        trader = new MockSeedTrader(weth);

        vm.startPrank(admin);
        faces.setSeeder(address(seeder));
        faces.setProvenanceHash(keccak256("art"));
        seeder.grantRole(seeder.CONFIG_ROLE(), admin);
        _basket(1, _legs1(address(tsla), 0.002e18));
        _basket(2, _legs1(address(nvda), 0.003e18));
        uint32[] memory g = new uint32[](2);
        (g[0], g[1]) = (1, 2);
        seeder.setTierBaskets(1, g);
        vault.setSeeder(seeder);
        vault.setTrader(ISeedTrader(address(trader)));
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        // OpenSea Studio's setup, done by the admin (no sale manager on this collection)
        faces.updateCreatorPayoutAddress(SEADROP, address(vaultPayout));
        faces.updateAllowedFeeRecipient(SEADROP, openseaFee, true);
        faces.updatePublicDrop(SEADROP, _publicDrop(10));
        vm.stopPrank();
    }

    function _path(address token) internal view returns (address[] memory p) {
        p = new address[](2);
        (p[0], p[1]) = (weth, token);
    }

    function _fees() internal pure returns (uint24[] memory f) {
        f = new uint24[](1);
        f[0] = 3000;
    }

    function test_MintFundsItsOwnSeeds() public {
        // empty pool: the first Faces get their account, the seed waits
        _mintPublic(alice, 4);
        assertEq(seeder.activatedCount(), 4);
        assertEq(seeder.fundedCount(), 0);

        // the seed share reaches the vault (anyone can push the split)
        vm.prank(carol);
        vaultPayout.release(payable(address(vault)));
        uint256 seedShare = uint256(PUBLIC_PRICE) * 4 * 9 / 10 * 40 / 100;
        assertEq(address(vault).balance, seedShare);

        // the keeper turns it into basket tokens, straight into the pool
        vm.startPrank(keeper);
        vault.buy(_path(address(tsla)), _fees(), 0.01e18, 100);
        vault.buy(_path(address(nvda)), _fees(), 0.015e18, 100);
        vm.stopPrank();
        assertEq(tsla.balanceOf(address(seeder)), 0.01e18);
        assertEq(address(vault).balance, seedShare - 0.025e18);

        // pending seeds are delivered by anyone
        uint256[] memory ids = new uint256[](4);
        (ids[0], ids[1], ids[2], ids[3]) = (1, 2, 3, 4);
        vm.prank(carol);
        seeder.activateBatch(ids);
        assertEq(seeder.fundedCount(), 4);

        // with stock in the pool, the next Face is born seeded
        _mintPublic(bob, 1);
        assertTrue(seeder.seedOf(5).funded);
    }

    function test_KeeperCanOnlyBuyBasketTokensForThePool() public {
        vm.deal(address(vault), 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, vault.KEEPER_ROLE())
        );
        vm.prank(alice);
        vault.buy(_path(address(tsla)), _fees(), 0.1 ether, 100);

        vm.startPrank(keeper);
        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.NotBasketToken.selector, address(spy)));
        vault.buy(_path(address(spy)), _fees(), 0.1 ether, 100); // not in any basket

        address[] memory fromToken = new address[](2);
        (fromToken[0], fromToken[1]) = (address(usdg), address(tsla));
        vm.expectRevert(NeonSeedVault.MustPayWithEth.selector);
        vault.buy(fromToken, _fees(), 1, 100);
        vm.stopPrank();
        assertEq(address(vault).balance, 1 ether);
    }

    function test_SurplusOnlyToTreasuryAfterBasketsLock() public {
        _mintPublic(alice, 2); // empty pool: both seeds pending
        vm.startPrank(admin);
        faces.grantRole(faces.METADATA_ROLE(), admin);
        faces.requestReveal();
        vm.stopPrank();
        vm.roll(block.number + 6);
        faces.reveal();
        vm.deal(address(vault), 1 ether);
        vm.startPrank(admin);
        vm.expectRevert(NeonSeedVault.BasketsNotLocked.selector);
        vault.releaseSurplus(1 ether);
        seeder.lockConfig();
        vm.expectRevert(NeonSeedVault.SeedsStillOwed.selector); // the ETH must buy the pending seeds first
        vault.releaseSurplus(0.4 ether);
        vm.stopPrank();

        tsla.mint(address(seeder), 2 * 0.002e18);
        nvda.mint(address(seeder), 2 * 0.003e18);
        assertTrue(seeder.covered());
        vm.prank(admin);
        vault.releaseSurplus(0.4 ether);
        assertEq(treasury.balance, 0.4 ether);

        vm.prank(keeper);
        vm.expectRevert();
        vault.releaseSurplus(0.1 ether);
    }

    function test_SurplusFreeAfterGraceIfSeedsCantBeBought() public {
        _mintPublic(alice, 1);
        vm.startPrank(admin);
        faces.grantRole(faces.METADATA_ROLE(), admin);
        faces.requestReveal();
        vm.stopPrank();
        vm.roll(block.number + 6);
        faces.reveal();
        vm.deal(address(vault), 1 ether);
        vm.startPrank(admin);
        seeder.lockConfig();
        vm.expectRevert(NeonSeedVault.SeedsStillOwed.selector);
        vault.releaseSurplus(1 ether);
        vm.warp(block.timestamp + vault.OWED_GRACE());
        vault.releaseSurplus(1 ether);
        vm.stopPrank();
        assertEq(treasury.balance, 1 ether);
    }

    function test_WiringIsOnce() public {
        vm.startPrank(admin);
        vm.expectRevert(NeonSeedVault.AlreadySet.selector);
        vault.setSeeder(seeder);
        vm.expectRevert(NeonSeedVault.AlreadySet.selector);
        vault.setTrader(ISeedTrader(address(trader)));
        vm.stopPrank();
        assertGt(trader.dailyLimit(address(vault)), 1e30, "no daily cap on the vault's own buys");
    }
}
