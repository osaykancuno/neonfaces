// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {NeonTrader, ISwapRouter02} from "../src/NeonTrader.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";
import {NeonSeedVault, ISeedTrader} from "../src/NeonSeedVault.sol";

/// @notice The multi-asset baskets on Robinhood Chain mainnet: the seed vault buys QQQ, gold, silver, bitcoin
/// and SpaceX through NeonTrader on the real Uniswap pools (bitcoin straight from ETH, the rest through USDG), and
/// the seeder delivers them into a Face account.
/// Run: ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract RwaForkTest -vv
contract RwaForkTest is Test {
    IERC6551Registry constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    struct Asset {
        address token;
        address feed;
        uint24 fee; // pool fee against its hub
        bool viaWeth; // hub is WETH (bitcoin), else USDG
    }

    function _assets() internal pure returns (Asset[5] memory a) {
        a[0] = Asset(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 500, false); // QQQ
        a[1] = Asset(0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e, 0x470A51258068043bd43dC0a56245625C9fE86eB0, 3000, false); // GLD
        a[2] = Asset(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 0x209b73908e92Ae021826eD79609845451Ecba2ce, 3000, false); // SLV
        a[3] = Asset(0xCEC185eB182c47d1bA1EFc84e6959e18cd620Be4, 0x0009cD492adf8167f9eEBf1293556A673530a21a, 3000, true); // cbBTC
        a[4] = Asset(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 500, false); // SPCX
    }

    NeonSeeder seeder;
    NeonSeedVault vault;
    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");

    /// @dev the keeper's buy along the route tools/route.mjs computes (bitcoin from ETH, the rest via USDG)
    function _buy(Asset memory x, uint32 basketId) internal returns (uint256 out) {
        address[] memory path = new address[](x.viaWeth ? 2 : 3);
        uint24[] memory fees = new uint24[](x.viaWeth ? 1 : 2);
        if (x.viaWeth) {
            (path[0], path[1], fees[0]) = (WETH, x.token, x.fee);
        } else {
            (path[0], path[1], path[2], fees[0], fees[1]) = (WETH, USDG, x.token, 100, x.fee);
        }
        // the vault only buys basket tokens: list it in a basket first
        NeonSeeder.Leg[] memory one = new NeonSeeder.Leg[](1);
        one[0] = NeonSeeder.Leg(x.token, 1);
        vm.prank(admin);
        seeder.setBasket(basketId, one);
        // a pool more than 1% off its Chainlink feed (weekends, thin hours) refuses the buy: that leg waits
        vm.prank(keeper);
        try vault.buy(path, fees, 0.01 ether, 100) returns (uint256 o) {
            out = o;
        } catch {
            console2.log("skipped (pool off its Chainlink feed right now):", x.token);
        }
    }

    function test_Fork_MultiAssetBasketIsBoughtAndSeeded() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        Asset[5] memory a = _assets();
        address[] memory tokens = new address[](7);
        address[] memory feeds = new address[](7);
        (tokens[0], feeds[0]) = (USDG, 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2);
        (tokens[1], feeds[1]) = (WETH, 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9);
        for (uint256 i; i < 5; ++i) (tokens[i + 2], feeds[i + 2]) = (a[i].token, a[i].feed);
        NeonTrader trader = new NeonTrader(ISwapRouter02(ROUTER), WETH, tokens, feeds);

        NeonFaceAccount impl = new NeonFaceAccount();
        NeonFaces faces = new NeonFaces(admin, admin, makeAddr("payout"), address(0), "", "");
        seeder = new NeonSeeder(faces, REGISTRY, address(impl), admin);
        vault = new NeonSeedVault(payable(makeAddr("treasury")), admin);
        vm.startPrank(admin);
        faces.setProvenanceHash(keccak256("fork"));
        faces.setSeeder(address(seeder));
        faces.teamMint(admin, 1); // Face #1: account created, seed pending (no basket yet)
        vault.setSeeder(seeder);
        vault.setTrader(ISeedTrader(address(trader)));
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        seeder.grantRole(seeder.CONFIG_ROLE(), admin);
        vm.stopPrank();
        vm.deal(address(vault), 1 ether);

        // what the keeper buys: ~$27 of each asset
        uint256[5] memory bought;
        uint256 n;
        for (uint256 i; i < 5; ++i) {
            bought[i] = _buy(a[i], uint32(i + 1));
            assertEq(IERC20(a[i].token).balanceOf(address(seeder)), bought[i], "straight into the pool");
            if (bought[i] > 0) ++n;
            console2.log("bought", bought[i]);
        }
        assertGe(n, 4, "at most one pool off its feed at a time");

        // a multi-asset basket (half of what was bought, per leg) delivered into Face #1's account
        NeonSeeder.Leg[] memory legs = new NeonSeeder.Leg[](n);
        n = 0;
        for (uint256 i; i < 5; ++i) {
            if (bought[i] > 0) legs[n++] = NeonSeeder.Leg(a[i].token, bought[i] / 2);
        }
        vm.startPrank(admin);
        seeder.setBasket(6, legs);
        uint32[] memory base = new uint32[](1);
        base[0] = 6;
        seeder.setTierBaskets(1, base);
        vm.stopPrank();
        uint256 g = gasleft();
        seeder.fund(1);
        uint256 used = g - gasleft();
        console2.log("gas to deliver the real Stock Token legs:", used);
        // a set bonus has 4 legs and NeonFaces gives its in-transfer delivery 1M gas: keep a wide margin
        assertLt(used, 500_000, "real token deliveries fit the set bonus gas budget");
        address account = seeder.accountOf(1);
        for (uint256 i; i < 5; ++i) {
            assertEq(IERC20(a[i].token).balanceOf(account), bought[i] / 2, "every asset reaches the Face");
        }
    }
}
