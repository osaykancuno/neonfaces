// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {NeonArt} from "../src/NeonArt.sol";
import {NeonRenderer} from "../src/NeonRenderer.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";
import {MockStockToken} from "../test/mocks/MockStockToken.sol";

/// @notice Deploys the full, fully on-chain NEONFACES system.
///
/// Environment (see contracts/.env.example):
///   ADMIN              final admin (Safe multisig 3/5)
///   ROYALTY_RECEIVER   5% royalty receiver (Safe)
///   SEED_VAULT, TREASURY, GROWTH   split payees (40 / 25 / 15)
///   TEAM_BENEFICIARY   receives the team 20% through a 6-month VestingWallet
///   SITE_URL           e.g. https://neonfaces.xyz/  (external_url prefix in the on-chain metadata)
///   USE_MOCK_TOKENS    true on testnet/local: deploys mock TSLA/NVDA/AAPL/SPY/USDG and fills the pool
///   BASKETS_FILE       seed baskets json (default config/baskets.<chainid>.json)
///
/// Reads art/output/provenance.json (provenance hash, committed here, before any mint) and
/// art/output/onchain/placeholder.hex. Then run UploadArt.s.sol to store the 5555 Faces on-chain.
///
/// The deployer keeps the admin role only until the Safe accepts it: every contract starts a
/// 2-step admin transfer to ADMIN (`acceptDefaultAdminTransfer()` after the delay).
contract Deploy is Script {
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    struct Deployed {
        NeonFaceAccount accountImpl;
        NeonFaces faces;
        NeonSeeder seeder;
        NeonMinter minter;
        NeonArt art;
        NeonRenderer renderer;
        VestingWallet teamVesting;
    }

    function run() external returns (Deployed memory d) {
        address deployer = msg.sender;
        address admin = vm.envAddress("ADMIN");
        bool mocks = vm.envOr("USE_MOCK_TOKENS", false);
        require(REGISTRY.code.length > 0, "ERC-6551 registry missing on this chain");

        string memory prov = vm.readFile("../art/output/provenance.json");
        bytes32 provenance = vm.parseJsonBytes32(prov, ".provenanceHash");
        bytes memory placeholder = vm.parseBytes(vm.trim(vm.readFile("../art/output/onchain/placeholder.hex")));

        vm.startBroadcast();

        d.accountImpl = new NeonFaceAccount();
        d.faces = new NeonFaces(deployer, vm.envAddress("ROYALTY_RECEIVER"), "", "");
        d.seeder = new NeonSeeder(d.faces, IERC6551Registry(REGISTRY), address(d.accountImpl), deployer);
        d.teamVesting = new VestingWallet(
            vm.envAddress("TEAM_BENEFICIARY"),
            uint64(vm.envOr("VESTING_START", block.timestamp)),
            uint64(vm.envOr("VESTING_DURATION", uint256(180 days)))
        );
        d.minter = new NeonMinter(
            d.faces,
            d.seeder,
            deployer,
            payable(vm.envAddress("SEED_VAULT")),
            payable(vm.envAddress("TREASURY")),
            payable(address(d.teamVesting)),
            payable(vm.envAddress("GROWTH"))
        );
        d.art = new NeonArt(d.faces, deployer);
        d.renderer = new NeonRenderer(d.faces, d.seeder, d.art, placeholder, vm.envString("SITE_URL"));

        // ---- wiring ----
        d.faces.grantRole(d.faces.MINTER_ROLE(), address(d.minter));
        d.faces.grantRole(d.faces.PAUSER_ROLE(), admin);
        d.faces.grantRole(d.faces.METADATA_ROLE(), admin);
        d.faces.grantRole(d.faces.METADATA_ROLE(), deployer);
        d.faces.setRenderer(address(d.renderer)); // metadata + art served 100% on-chain
        if (admin != deployer) d.faces.renounceRole(d.faces.METADATA_ROLE(), deployer);
        d.faces.setProvenanceHash(provenance); // commitment BEFORE any mint
        d.art.grantRole(d.art.ARTIST_ROLE(), deployer); // for UploadArt.s.sol
        d.seeder.grantRole(d.seeder.CONFIG_ROLE(), admin);
        d.minter.grantRole(d.minter.OPERATOR_ROLE(), admin);

        // ---- seed baskets (deployer temporarily holds CONFIG_ROLE) ----
        d.seeder.grantRole(d.seeder.CONFIG_ROLE(), deployer);
        if (mocks) _mockBaskets(d.seeder);
        else _basketsFromFile(d.seeder);
        d.seeder.revokeRole(d.seeder.CONFIG_ROLE(), deployer);

        // ---- hand over to the Safe ----
        if (admin != deployer) {
            d.minter.revokeRole(d.minter.OPERATOR_ROLE(), deployer);
            d.faces.beginDefaultAdminTransfer(admin);
            d.seeder.beginDefaultAdminTransfer(admin);
            d.minter.beginDefaultAdminTransfer(admin);
            d.art.beginDefaultAdminTransfer(admin);
        }

        vm.stopBroadcast();
        _write(d);
    }

    // ------------------------------------------------------------------
    // Baskets
    // ------------------------------------------------------------------
    function _basketsFromFile(NeonSeeder seeder) internal {
        string memory path = vm.envOr("BASKETS_FILE", string.concat("config/baskets.", vm.toString(block.chainid), ".json"));
        string memory json = vm.readFile(path);
        uint256 n = vm.parseJsonUint(json, ".basketCount");
        for (uint256 i; i < n; ++i) {
            string memory key = string.concat(".baskets[", vm.toString(i), "]");
            address[] memory tokens = vm.parseJsonAddressArray(json, string.concat(key, ".tokens"));
            uint256[] memory amounts = vm.parseJsonUintArray(json, string.concat(key, ".amounts"));
            require(tokens.length == amounts.length, "basket shape");
            NeonSeeder.Leg[] memory legs = new NeonSeeder.Leg[](tokens.length);
            for (uint256 j; j < tokens.length; ++j) legs[j] = NeonSeeder.Leg(tokens[j], amounts[j]);
            seeder.setBasket(uint32(i + 1), legs);
        }
        for (uint8 t = 1; t <= 3; ++t) {
            uint256[] memory ids = vm.parseJsonUintArray(json, string.concat(".tiers.", vm.toString(t)));
            uint32[] memory ids32 = new uint32[](ids.length);
            for (uint256 j; j < ids.length; ++j) ids32[j] = uint32(ids[j]);
            seeder.setTierBaskets(t, ids32);
        }
    }

    function _mockBaskets(NeonSeeder seeder) internal {
        MockStockToken tsla = new MockStockToken("Tesla (test)", "TSLA", 18);
        MockStockToken nvda = new MockStockToken("NVIDIA (test)", "NVDA", 18);
        MockStockToken aapl = new MockStockToken("Apple (test)", "AAPL", 18);
        MockStockToken spy = new MockStockToken("SPDR S&P 500 (test)", "SPY", 18);
        MockStockToken usdg = new MockStockToken("Global Dollar (test)", "USDG", 6);
        tsla.mint(address(seeder), 100e18);
        nvda.mint(address(seeder), 100e18);
        aapl.mint(address(seeder), 100e18);
        spy.mint(address(seeder), 100e18);
        usdg.mint(address(seeder), 1_000_000e6);

        NeonSeeder.Leg[] memory l = new NeonSeeder.Leg[](1);
        l[0] = NeonSeeder.Leg(address(tsla), 0.003e18);
        seeder.setBasket(1, l);
        l[0] = NeonSeeder.Leg(address(nvda), 0.005e18);
        seeder.setBasket(2, l);
        l[0] = NeonSeeder.Leg(address(aapl), 0.004e18);
        seeder.setBasket(3, l);
        NeonSeeder.Leg[] memory m = new NeonSeeder.Leg[](2);
        m[0] = NeonSeeder.Leg(address(nvda), 0.02e18);
        m[1] = NeonSeeder.Leg(address(usdg), 1e6);
        seeder.setBasket(4, m);
        NeonSeeder.Leg[] memory h = new NeonSeeder.Leg[](4);
        h[0] = NeonSeeder.Leg(address(spy), 0.02e18);
        h[1] = NeonSeeder.Leg(address(nvda), 0.03e18);
        h[2] = NeonSeeder.Leg(address(tsla), 0.02e18);
        h[3] = NeonSeeder.Leg(address(usdg), 5e6);
        seeder.setBasket(5, h);

        uint32[] memory g = new uint32[](3);
        (g[0], g[1], g[2]) = (1, 2, 3);
        seeder.setTierBaskets(1, g);
        uint32[] memory w = new uint32[](1);
        w[0] = 4;
        seeder.setTierBaskets(2, w);
        uint32[] memory hv = new uint32[](1);
        hv[0] = 5;
        seeder.setTierBaskets(3, hv);
        console2.log("mock TSLA", address(tsla));
        console2.log("mock NVDA", address(nvda));
        console2.log("mock AAPL", address(aapl));
        console2.log("mock SPY ", address(spy));
        console2.log("mock USDG", address(usdg));
    }

    // ------------------------------------------------------------------
    // Output: deployments/<chainid>.json (read by tools/ and web/)
    // ------------------------------------------------------------------
    function _write(Deployed memory d) internal {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "deployBlock", block.number);
        vm.serializeAddress(o, "registry", REGISTRY);
        vm.serializeAddress(o, "accountImplementation", address(d.accountImpl));
        vm.serializeAddress(o, "faces", address(d.faces));
        vm.serializeAddress(o, "seeder", address(d.seeder));
        vm.serializeAddress(o, "art", address(d.art));
        vm.serializeAddress(o, "renderer", address(d.renderer));
        vm.serializeAddress(o, "teamVesting", address(d.teamVesting));
        string memory out = vm.serializeAddress(o, "minter", address(d.minter));
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("NeonFaces     ", address(d.faces));
        console2.log("NeonSeeder    ", address(d.seeder));
        console2.log("NeonMinter    ", address(d.minter));
        console2.log("NeonArt       ", address(d.art));
        console2.log("NeonRenderer  ", address(d.renderer));
        console2.log("FaceAccount   ", address(d.accountImpl));
        console2.log("TeamVesting   ", address(d.teamVesting));
        console2.log("written", path);
    }
}
