// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {ERC6551} from "solady/accounts/ERC6551.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {NeonTrader, ISwapRouter02} from "../src/NeonTrader.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";

/// @notice NeonTrader against the REAL Uniswap v3 router, pools and Chainlink feeds on Robinhood Chain mainnet.
/// Run: ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract TraderForkTest -vv
contract TraderForkTest is Test {
    IERC6551Registry constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant WHALE = 0x8366a39CC670B4001A1121B8F6A443A643e40951; // Uniswap v4 PoolManager

    NeonTrader trader;
    NeonFaceAccount acc;
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;

        address[] memory tokens = new address[](4);
        address[] memory feeds = new address[](4);
        (tokens[0], feeds[0]) = (USDG, 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2);
        (tokens[1], feeds[1]) = (WETH, 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9);
        (tokens[2], feeds[2]) = (TSLA, 0x4A1166a659A55625345e9515b32adECea5547C38);
        (tokens[3], feeds[3]) = (NVDA, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15);
        trader = new NeonTrader(ISwapRouter02(ROUTER), WETH, tokens, feeds);

        // a real Face with its account
        address admin = makeAddr("admin");
        NeonFaceAccount impl = new NeonFaceAccount();
        NeonFaces faces = new NeonFaces(admin, admin, makeAddr("payout"), address(0), "", "");
        NeonSeeder seeder = new NeonSeeder(faces, REGISTRY, address(impl), admin);
        vm.startPrank(admin);
        faces.setProvenanceHash(keccak256("fork"));
        faces.setSeeder(address(seeder));
        faces.teamMint(alice, 1); // creates the account (no baskets configured: seed stays pending)
        vm.stopPrank();
        acc = NeonFaceAccount(payable(seeder.accountOf(1)));

        vm.prank(WHALE);
        IERC20(USDG).transfer(address(acc), 1_000e6);
        vm.deal(address(acc), 1 ether);

        // holder: approve the trader once, set a daily cap, delegate an agent that may ONLY call trader.swap
        ERC6551.Call[] memory setup = new ERC6551.Call[](3);
        setup[0] = ERC6551.Call(USDG, 0, abi.encodeCall(IERC20.approve, (address(trader), type(uint256).max)));
        setup[1] = ERC6551.Call(TSLA, 0, abi.encodeCall(IERC20.approve, (address(trader), type(uint256).max)));
        setup[2] = ERC6551.Call(address(trader), 0, abi.encodeCall(NeonTrader.setDailyLimit, (500e8)));
        NeonFaceAccount.Permission[] memory perms = new NeonFaceAccount.Permission[](1);
        perms[0] = NeonFaceAccount.Permission(address(trader), NeonTrader.swap.selector);
        vm.startPrank(alice);
        acc.executeBatch(setup, 0);
        acc.setAgent(agent, uint64(block.timestamp + 7 days), perms, 0.2 ether);
        vm.stopPrank();
    }

    function _path2(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        (p[0], p[1]) = (a, b);
    }

    function _fees1(uint24 f) internal pure returns (uint24[] memory x) {
        x = new uint24[](1);
        x[0] = f;
    }

    function _agentSwap(address[] memory path, uint24[] memory fees, uint256 amountIn, uint256 slip, uint256 value)
        internal
    {
        vm.prank(agent);
        acc.executeAsAgent(address(trader), value, abi.encodeCall(NeonTrader.swap, (path, fees, amountIn, slip)));
    }

    function test_Fork_AgentBuysAndSellsAtFairPrice() public {
        if (!forked) return;
        // buy TSLA with 100 USDG (TSLA/USDG 0.3% pool)
        (uint256 minOut, uint256 usd) = trader.quote(_path2(USDG, TSLA), _fees1(3000), 100e6, 100);
        _agentSwap(_path2(USDG, TSLA), _fees1(3000), 100e6, 100, 0);
        uint256 tsla = IERC20(TSLA).balanceOf(address(acc));
        console2.log("TSLA bought for 100 USDG (1e18):", tsla);
        console2.log("oracle min out                 :", minOut);
        assertGe(tsla, minOut);
        assertApproxEqRel(usd, 100e8, 0.01e18);
        assertEq(IERC20(TSLA).balanceOf(agent) + IERC20(USDG).balanceOf(agent), 0, "nothing reaches the agent");

        // sell half of it back
        _agentSwap(_path2(TSLA, USDG), _fees1(3000), tsla / 2, 100, 0);
        assertGt(IERC20(USDG).balanceOf(address(acc)), 900e6 + 45e6);
    }

    function test_Fork_AgentBuysWithEthThroughUsdg() public {
        if (!forked) return;
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (WETH, USDG, NVDA);
        uint24[] memory fees = new uint24[](2);
        (fees[0], fees[1]) = (100, 500);
        _agentSwap(path, fees, 0.02 ether, 100, 0.02 ether);
        uint256 nvda = IERC20(NVDA).balanceOf(address(acc));
        console2.log("NVDA bought for 0.02 ETH (1e18):", nvda);
        assertGt(nvda, 0);
        (,,,, uint256 left) = acc.agentConfig();
        assertEq(left, 0.18 ether, "ETH budget consumed");
    }

    function test_Fork_AgentCannotBypassTheRules() public {
        if (!forked) return;
        // direct router call with itself as recipient: not an allowed call
        bytes memory steal = abi.encodeCall(
            ISwapRouter02.exactInput,
            (ISwapRouter02.ExactInputParams(abi.encodePacked(USDG, uint24(3000), TSLA), agent, 100e6, 0))
        );
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AgentCallNotAllowed.selector, ROUTER, ISwapRouter02.exactInput.selector));
        acc.executeAsAgent(ROUTER, 0, steal);

        // accept a terrible price: capped at 1%
        vm.prank(agent);
        vm.expectRevert(NeonTrader.SlippageTooHigh.selector);
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(NeonTrader.swap, (_path2(USDG, TSLA), _fees1(3000), 100e6, 5000)));

        // exceed the holder's daily cap ($500)
        vm.prank(agent);
        vm.expectRevert();
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(NeonTrader.swap, (_path2(USDG, TSLA), _fees1(3000), 600e6, 100)));

        // unknown token
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonTrader.UnknownToken.selector, address(0xdead)));
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(NeonTrader.swap, (_path2(USDG, address(0xdead)), _fees1(3000), 1e6, 100)));

        // stale prices (e.g. equities over a weekend): trading stops
        vm.warp(block.timestamp + 27 hours);
        vm.prank(agent);
        vm.expectRevert();
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(NeonTrader.swap, (_path2(USDG, TSLA), _fees1(3000), 10e6, 100)));
    }

    function test_Fork_CallerOnlySpendsItsOwnTokens() public {
        if (!forked) return;
        // the account approved the trader, but nobody else can make the trader spend the account's tokens:
        // swap() only ever pulls from msg.sender and pays msg.sender
        vm.prank(WHALE);
        IERC20(USDG).transfer(agent, 10e6);
        vm.startPrank(agent);
        trader.setDailyLimit(1_000e8);
        IERC20(USDG).approve(address(trader), 10e6);
        trader.swap(_path2(USDG, TSLA), _fees1(3000), 10e6, 100);
        vm.stopPrank();
        assertEq(IERC20(USDG).balanceOf(address(acc)), 1_000e6, "the Face's USDG untouched");
        assertGt(IERC20(TSLA).balanceOf(agent), 0);
    }
}
