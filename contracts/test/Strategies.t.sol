// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {NeonTrader, ISwapRouter02} from "../src/NeonTrader.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {MockFeed, MockV3Router} from "./mocks/MockUniswap.sol";

/// @notice Standing strategies and noted trades on NeonTrader, and an agent running them through a Face.
contract StrategiesTest is Base {
    NeonTrader trader;
    MockV3Router router;
    NeonFaceAccount acc;
    address agent = makeAddr("agent");
    address weth = makeAddr("weth"); // never traded here, only needs a feed

    function setUp() public override {
        super.setUp();
        router = new MockV3Router();
        MockFeed fUsdg = new MockFeed(1e8);
        MockFeed fTsla = new MockFeed(400e8);
        MockFeed fNvda = new MockFeed(200e8);
        MockFeed fWeth = new MockFeed(2_700e8);
        router.setFeed(address(usdg), fUsdg);
        router.setFeed(address(tsla), fTsla);
        router.setFeed(address(nvda), fNvda);
        address[] memory tokens = new address[](4);
        address[] memory feeds = new address[](4);
        (tokens[0], feeds[0]) = (address(usdg), address(fUsdg));
        (tokens[1], feeds[1]) = (address(tsla), address(fTsla));
        (tokens[2], feeds[2]) = (address(nvda), address(fNvda));
        (tokens[3], feeds[3]) = (weth, address(fWeth));
        trader = new NeonTrader(ISwapRouter02(address(router)), weth, tokens, feeds);
        tsla.mint(address(router), 1_000e18);
        nvda.mint(address(router), 1_000e18);
        usdg.mint(address(router), 1_000_000e6);

        _openPublic();
        _mintPublic(alice, 1);
        acc = NeonFaceAccount(payable(seeder.accountOf(1)));
        usdg.mint(address(acc), 500e6);
    }

    function _holder(address target, bytes memory data) internal {
        vm.prank(alice);
        acc.execute(target, 0, data, 0);
    }

    function _strategy(uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8)
        internal
        pure
        returns (NeonTrader.Strategy memory)
    {
        return NeonTrader.Strategy(kind, token, funding, bps, every, usd8);
    }

    function test_Strategy_SetByTheFaceClearedWithKindZero() public {
        NeonTrader.Strategy memory s = _strategy(1, address(tsla), address(usdg), 0, 7 days, 5e8);
        _holder(address(trader), abi.encodeCall(trader.setStrategy, (s)));
        NeonTrader.Strategy memory got = trader.strategyOf(address(acc));
        assertEq(got.kind, 1);
        assertEq(got.token, address(tsla));
        assertEq(got.usd8, 5e8);
        assertEq(trader.strategyOf(alice).kind, 0, "per account");

        _holder(address(trader), abi.encodeCall(trader.setStrategy, (_strategy(0, address(0), address(0), 0, 0, 0))));
        assertEq(trader.strategyOf(address(acc)).kind, 0);
    }

    function test_Strategy_Validation() public {
        address bad = makeAddr("unlisted");
        NeonTrader.Strategy[6] memory wrong = [
            _strategy(4, address(tsla), address(usdg), 0, 1 days, 1e8), // unknown kind
            _strategy(1, bad, address(usdg), 0, 1 days, 1e8), // unlisted token
            _strategy(1, address(tsla), address(tsla), 0, 1 days, 1e8), // pays with itself
            _strategy(1, address(tsla), address(usdg), 0, 30 minutes, 1e8), // too often
            _strategy(2, address(usdg), address(0), 10_000, 1 days, 0), // 100% liquid
            _strategy(3, address(tsla), address(usdg), 0, 1 days, 0) // trim at 0%
        ];
        for (uint256 i; i < wrong.length; ++i) {
            vm.expectRevert(NeonTrader.BadStrategy.selector);
            trader.setStrategy(wrong[i]);
        }
        trader.setStrategy(_strategy(2, address(usdg), address(0), 4_000, 1 days, 0)); // keep 40% in USDG
        trader.setStrategy(_strategy(3, address(tsla), address(usdg), 5_000, 1 days, 0)); // trim TSLA above 50%
    }

    function test_Note_AgentTradesThroughTheFaceWithAReason() public {
        // holder: daily cap, approval, strategy, and an agent allowed only swapWithNote
        _holder(address(trader), abi.encodeCall(trader.setDailyLimit, (100e8)));
        _holder(address(usdg), abi.encodeWithSignature("approve(address,uint256)", address(trader), type(uint256).max));
        NeonFaceAccount.Permission[] memory p = new NeonFaceAccount.Permission[](1);
        p[0] = NeonFaceAccount.Permission(address(trader), trader.swapWithNote.selector);
        vm.prank(alice);
        acc.setAgent(agent, uint64(block.timestamp + 30 days), p, 0);

        address[] memory path = new address[](2);
        (path[0], path[1]) = (address(usdg), address(tsla));
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000;
        bytes memory call = abi.encodeCall(trader.swapWithNote, (path, fees, 20e6, 50, "accumulate TSLA: $20 weekly"));

        uint256 before = tsla.balanceOf(address(acc));
        vm.expectEmit(address(trader));
        emit NeonTrader.Note(address(acc), "accumulate TSLA: $20 weekly");
        vm.prank(agent);
        acc.executeAsAgent(address(trader), 0, call);
        assertEq(tsla.balanceOf(address(acc)) - before, 0.05e18, "bought at the oracle price, into the Face");
        assertEq(trader.leftToday(address(acc)), 80e8);

        // the plain swap was not allowed, only the noted one
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(NeonFaceAccount.AgentCallNotAllowed.selector, address(trader), trader.swap.selector)
        );
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(trader.swap, (path, fees, 20e6, 50)));

        // notes are short, and the daily cap still rules
        string memory long = "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456";
        vm.prank(agent);
        vm.expectRevert(NeonTrader.NoteTooLong.selector);
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(trader.swapWithNote, (path, fees, 20e6, 50, long)));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(NeonTrader.DailyLimitExceeded.selector, 90e8, 80e8));
        acc.executeAsAgent(address(trader), 0, abi.encodeCall(trader.swapWithNote, (path, fees, 90e6, 50, "too much")));
    }

    function test_Note_BadPriceIsRefusedEvenWithANote() public {
        _holder(address(trader), abi.encodeCall(trader.setDailyLimit, (100e8)));
        _holder(address(usdg), abi.encodeWithSignature("approve(address,uint256)", address(trader), type(uint256).max));
        router.setHaircut(300); // the pool pays 3% under the oracle
        address[] memory path = new address[](2);
        (path[0], path[1]) = (address(usdg), address(tsla));
        uint24[] memory fees = new uint24[](1);
        fees[0] = 3000; // 0.3% pool fee + 1% max slippage < 3%
        vm.prank(alice);
        vm.expectRevert(bytes("Too little received"));
        acc.execute(address(trader), 0, abi.encodeCall(trader.swapWithNote, (path, fees, 20e6, 100, "dump")), 0);
    }
    function test_Route_ExpensivePoolsCantWidenThePrice() public {
        address[] memory path = new address[](2);
        (path[0], path[1]) = (address(usdg), address(tsla));
        uint24[] memory fees = new uint24[](1);
        fees[0] = 10_000; // a 1% pool: allowed, the minimum counts it
        (uint256 minOut,) = trader.quote(path, fees, 100e6, 100);
        assertEq(minOut, uint256(100e18) / 400 * 98 / 100);
        // three 1% hops (pools an agent could seed itself) would widen it to 4%: refused
        address[] memory hops = new address[](4);
        (hops[0], hops[1], hops[2], hops[3]) = (address(usdg), address(nvda), address(tsla), address(usdg));
        hops[3] = weth;
        uint24[] memory f3 = new uint24[](3);
        (f3[0], f3[1], f3[2]) = (10_000, 10_000, 10_000);
        vm.expectRevert(NeonTrader.RouteTooExpensive.selector);
        trader.quote(hops, f3, 100e6, 100);
        fees[0] = 10_100;
        vm.expectRevert(NeonTrader.RouteTooExpensive.selector);
        trader.quote(path, fees, 100e6, 0);
    }
}
