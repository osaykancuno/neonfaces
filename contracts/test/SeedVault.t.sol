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
        uint256 seedShare = uint256(PUBLIC_PRICE) * 4 * 9 / 10 * 55 / 100;
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

    /// Anyone can refill what minted Faces are owed, with the vault's ETH, never more than that, at most
    /// MAX_RESTOCK_USD8 per call: no delivery depends on the keeper.
    function test_AnyoneRestocksWhatIsOwedAndNoMore() public {
        _mintPublic(alice, 4); // empty pool: 4 seeds pending
        vaultPayout.release(payable(address(vault)));
        trader.setPrice(weth, 2_500e8);
        trader.setPrice(address(tsla), 100e8);
        trader.setPrice(address(nvda), 100e8);
        trader.setRate(25); // 1 wei of ETH buys 25 units of an 18-decimal $100 token: the oracle price

        uint256 owed = seeder.owed(address(tsla));
        assertEq(owed, 4 * 0.002e18);
        vm.prank(carol); // no role
        uint256 out = vault.restock(_path(address(tsla)), _fees());
        assertEq(tsla.balanceOf(address(seeder)), out);
        assertGe(out, owed, "covers what is owed");
        assertLe(out, owed * 104 / 100, "and not much more");

        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.NothingToRestock.selector, address(tsla)));
        vm.prank(carol);
        vault.restock(_path(address(tsla)), _fees());
        // a token no basket uses is never owed
        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.NothingToRestock.selector, address(spy)));
        vault.restock(_path(address(spy)), _fees());
        // anyone then delivers the pending seeds
        vm.prank(carol);
        vault.restock(_path(address(nvda)), _fees());
        for (uint256 id = 1; id <= 4; ++id) seeder.fund(id);
        assertEq(seeder.fundedCount(), 4);
    }

    function test_RestockIsCappedPerCall() public {
        _mintPublic(alice, 10);
        vaultPayout.release(payable(address(vault)));
        vm.deal(address(vault), 100 ether);
        trader.setPrice(weth, 2_500e8);
        trader.setPrice(address(tsla), 1_000_000e8); // an expensive token: the shortfall is worth far more than the cap
        trader.setRate(1);
        uint256 before = address(vault).balance;
        vault.restock(_path(address(tsla)), _fees());
        uint256 spent = before - address(vault).balance;
        assertEq(spent, uint256(2_000e8) * 1e18 * 103 / (2_500e8 * 100), "one call spends at most $2,000 (+3%)");
        // an empty vault says so (the treasury can send it ETH)
        vm.deal(address(vault), 0);
        trader.setPrice(address(nvda), 100e8); // still owed: nothing bought yet
        vm.expectRevert(NeonSeedVault.VaultEmpty.selector);
        vault.restock(_path(address(nvda)), _fees());
    }

    /// The site's one-click delivery: every short token bought, then the delivery, in a single transaction.
    function test_RestockAndDeliverInOneTransaction() public {
        _mintPublic(alice, 2); // empty pool: both seeds pending
        vaultPayout.release(payable(address(vault)));
        trader.setPrice(weth, 2_500e8);
        trader.setPrice(address(tsla), 100e8);
        trader.setPrice(address(nvda), 100e8);
        trader.setRate(25);
        address[][] memory paths = new address[][](2);
        uint24[][] memory fees = new uint24[][](2);
        (paths[0], paths[1], fees[0], fees[1]) = (_path(address(tsla)), _path(address(nvda)), _fees(), _fees());
        uint8 seed = vault.DELIVER_SEED();
        vm.prank(carol); // anyone
        vault.restockAndDeliver(seed, 1, paths, fees);
        assertTrue(seeder.seedOf(1).funded, "delivered in the same transaction");
        // the pool now holds enough for #2 too: the restock is skipped, the delivery still happens
        vm.prank(carol);
        vault.restockAndDeliver(seed, 2, paths, fees);
        assertTrue(seeder.seedOf(2).funded);
        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.UnknownDelivery.selector, uint8(9)));
        vault.restockAndDeliver(9, 1, paths, fees);
    }

    /// A market off its price refuses the buy with a clear reason, and nothing is bought or delivered.
    function test_MarketOffPriceIsNamed() public {
        _mintPublic(alice, 1);
        vaultPayout.release(payable(address(vault)));
        trader.setPrice(weth, 2_500e8);
        trader.setPrice(address(tsla), 100e8);
        trader.setPrice(address(nvda), 100e8);
        trader.setRate(25);
        trader.setOffPrice(address(nvda), true);
        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.MarketOffPrice.selector, address(nvda)));
        vault.restock(_path(address(nvda)), _fees());
        address[][] memory paths = new address[][](2);
        uint24[][] memory fees = new uint24[][](2);
        (paths[0], paths[1], fees[0], fees[1]) = (_path(address(tsla)), _path(address(nvda)), _fees(), _fees());
        uint8 seed = vault.DELIVER_SEED();
        vm.expectRevert(abi.encodeWithSelector(NeonSeedVault.MarketOffPrice.selector, address(nvda)));
        vault.restockAndDeliver(seed, 1, paths, fees);
        assertEq(tsla.balanceOf(address(seeder)), 0, "all or nothing: the TSLA buy rolled back too");
        assertFalse(seeder.seedOf(1).funded);
        // the market comes back: the same call goes through
        trader.setOffPrice(address(nvda), false);
        vault.restockAndDeliver(seed, 1, paths, fees);
        assertTrue(seeder.seedOf(1).funded);
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
