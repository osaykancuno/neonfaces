// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {NeonTrader, ISwapRouter02} from "../src/NeonTrader.sol";

/// @notice Deploys NeonTrader (no owner, no upgrade) from config/trader.<chainid>.json and records it in
/// deployments/<chainid>.json under "trader".
///   forge script script/DeployTrader.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast
contract DeployTrader is Script {
    function run() external returns (NeonTrader trader) {
        string memory cfg = vm.readFile(string.concat("../config/trader.", vm.toString(block.chainid), ".json"));
        address router = vm.parseJsonAddress(cfg, ".router");
        address weth = vm.parseJsonAddress(cfg, ".weth");
        uint256 n;
        while (vm.keyExistsJson(cfg, string.concat(".tokens[", vm.toString(n), "]"))) ++n;
        address[] memory tokens = new address[](n);
        address[] memory feeds = new address[](n);
        for (uint256 i; i < n; ++i) {
            string memory k = string.concat(".tokens[", vm.toString(i), "]");
            tokens[i] = vm.parseJsonAddress(cfg, string.concat(k, ".address"));
            feeds[i] = vm.parseJsonAddress(cfg, string.concat(k, ".feed"));
        }
        vm.startBroadcast();
        trader = new NeonTrader(ISwapRouter02(router), weth, tokens, feeds);
        vm.stopBroadcast();
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        if (!vm.exists(path)) vm.writeJson("{}", path);
        vm.writeJson(vm.toString(address(trader)), path, ".trader");
        console2.log("NeonTrader", address(trader));
    }
}
