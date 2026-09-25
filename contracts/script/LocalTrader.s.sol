// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {NeonTrader, ISwapRouter02} from "../src/NeonTrader.sol";
import {NeonSeedVault, ISeedTrader} from "../src/NeonSeedVault.sol";
import {MockStockToken} from "../test/mocks/MockStockToken.sol";
import {MockFeed, MockV3Router} from "../test/mocks/MockUniswap.sol";

/// @notice LOCAL REHEARSAL ONLY: a NeonTrader on mock Chainlink feeds and a mock Uniswap router that pays at the
/// oracle price, for the rehearsal's mock Stock Tokens. Lets agents, strategies and the keeper run end to end
/// on anvil. Writes "trader" into deployments/<chainid>.json and the token list to
/// deployments/trader.<chainid>.json (rehearsal.sh copies it to ../config/trader.<chainid>.json).
///   TSLA=0x.. NVDA=0x.. SPY=0x.. USDG=0x.. forge script script/LocalTrader.s.sol --rpc-url $RPC --private-key $PK --broadcast
contract LocalTrader is Script {
    string[4] syms = ["USDG", "TSLA", "NVDA", "SPY"];
    uint24[4] fees = [uint24(0), 3000, 500, 500];

    function run() external {
        require(block.chainid != 4663, "local only");
        (NeonTrader trader, address router, address[] memory tokens, address[] memory feeds) = _deploy();
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(vm.toString(address(trader)), path, ".trader");
        _writeConfig(router, tokens, feeds);
        console2.log("NeonTrader (local mocks)", address(trader));
    }

    function _deploy() internal returns (NeonTrader trader, address, address[] memory tokens, address[] memory feeds) {
        int256[4] memory px = [int256(1e8), 400e8, 200e8, 700e8];
        tokens = new address[](5);
        feeds = new address[](5);
        vm.startBroadcast();
        MockV3Router router = new MockV3Router();
        for (uint256 i; i < 4; ++i) {
            tokens[i] = vm.envAddress(syms[i]);
            MockFeed f = new MockFeed(px[i]);
            feeds[i] = address(f);
            router.setFeed(tokens[i], f);
            MockStockToken(tokens[i]).mint(address(router), i == 0 ? 10_000_000e6 : 100_000e18);
        }
        MockStockToken weth = new MockStockToken("Wrapped Ether (test)", "WETH", 18);
        MockFeed wf = new MockFeed(2_700e8);
        router.setFeed(address(weth), wf);
        (tokens[4], feeds[4]) = (address(weth), address(wf));
        trader = new NeonTrader(ISwapRouter02(address(router)), address(weth), tokens, feeds);
        string memory dep = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        if (vm.keyExistsJson(dep, ".seedVault")) {
            NeonSeedVault(payable(vm.parseJsonAddress(dep, ".seedVault"))).setTrader(ISeedTrader(address(trader)));
        }
        vm.stopBroadcast();
        return (trader, address(router), tokens, feeds);
    }

    function _entry(string memory sym, address token, address feed, uint256 fee) internal pure returns (string memory) {
        return string.concat(
            '{"symbol":"', sym, '","address":"', vm.toString(token), '","feed":"', vm.toString(feed), '","fee":', vm.toString(fee), "}"
        );
    }

    function _writeConfig(address router, address[] memory tokens, address[] memory feeds) internal {
        string memory list = _entry("WETH", tokens[4], feeds[4], 100);
        for (uint256 i; i < 4; ++i) list = string.concat(list, ",", _entry(syms[i], tokens[i], feeds[i], fees[i]));
        vm.writeFile(
            string.concat("deployments/trader.", vm.toString(block.chainid), ".json"),
            string.concat(
                '{"_readme":"LOCAL REHEARSAL ONLY (mock feeds and router), never commit","router":"', vm.toString(router),
                '","weth":"', vm.toString(tokens[4]), '","tokens":[', list, "]}"
            )
        );
    }
}
