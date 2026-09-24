// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";

/// @notice Full system on a fork of Robinhood Chain mainnet, seeding Faces with REAL Stock Tokens.
/// Run: ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract ForkTest -vv
contract ForkTest is Test {
    IERC6551Registry constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    // an existing on-chain holder of all four tokens (used only to source liquidity in the fork)
    address constant WHALE = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
    }

    function test_Fork_RealStockTokensSeedTheFace() public {
        if (!forked) {
            console2.log("skipped: ROBINHOOD_RPC_URL not set");
            return;
        }
        assertEq(block.chainid, 4663);
        assertEq(address(REGISTRY).codehash, 0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735);

        address admin = makeAddr("admin");
        NeonFaceAccount impl = new NeonFaceAccount();
        NeonFaces faces = new NeonFaces(admin, admin, "ipfs://u", "ipfs://c");
        NeonSeeder seeder = new NeonSeeder(faces, REGISTRY, address(impl), admin);
        VestingWallet vest = new VestingWallet(admin, uint64(block.timestamp), 180 days);
        NeonMinter minter = new NeonMinter(
            faces,
            seeder,
            admin,
            payable(makeAddr("seed")),
            payable(makeAddr("treasury")),
            payable(address(vest)),
            payable(makeAddr("growth"))
        );

        vm.startPrank(admin);
        faces.grantRole(faces.MINTER_ROLE(), address(minter));
        seeder.grantRole(seeder.CONFIG_ROLE(), admin);
        NeonSeeder.Leg[] memory legs = new NeonSeeder.Leg[](4);
        legs[0] = NeonSeeder.Leg(TSLA, 0.001e18);
        legs[1] = NeonSeeder.Leg(NVDA, 0.001e18);
        legs[2] = NeonSeeder.Leg(SPY, 0.001e18);
        legs[3] = NeonSeeder.Leg(USDG, 1e6);
        seeder.setBasket(1, legs);
        uint32[] memory ids = new uint32[](1);
        ids[0] = 1;
        seeder.setTierBaskets(1, ids);
        seeder.setTierBaskets(2, ids);
        seeder.setTierBaskets(3, ids);
        faces.setProvenanceHash(keccak256("fork test art"));
        minter.configurePhase(NeonMinter.Phase.Public, 0.01 ether, 5, 0, bytes32(0));
        minter.setPhase(NeonMinter.Phase.Public);
        vm.stopPrank();

        // load the seed pool with real tokens
        vm.startPrank(WHALE);
        IERC20(TSLA).transfer(address(seeder), 0.01e18);
        IERC20(NVDA).transfer(address(seeder), 0.01e18);
        IERC20(SPY).transfer(address(seeder), 0.01e18);
        IERC20(USDG).transfer(address(seeder), 10e6);
        vm.stopPrank();

        address alice = makeAddr("alice");
        vm.deal(alice, 1 ether);
        bytes32[] memory proof;
        vm.prank(alice);
        minter.mint{value: 0.02 ether}(2, 0, proof);

        for (uint256 id = 1; id <= 2; ++id) {
            NeonSeeder.SeedView memory s = seeder.seedOf(id);
            console2.log("face", id, "account", s.account);
            console2.log("  tier", s.tier, "funded", s.funded);
            assertTrue(s.funded, "real stock tokens accepted by the Face account");
            assertEq(IERC20(TSLA).balanceOf(s.account), 0.001e18);
            assertEq(IERC20(USDG).balanceOf(s.account), 1e6);
        }

        // the holder can take the exposure out of the Face
        NeonFaceAccount acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        vm.prank(alice);
        acc.execute(TSLA, 0, abi.encodeCall(IERC20.transfer, (alice, 0.001e18)), 0);
        assertEq(IERC20(TSLA).balanceOf(alice), 0.001e18);
    }
}
