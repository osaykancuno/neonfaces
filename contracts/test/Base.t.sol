// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

abstract contract Base is Test {
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    address admin = makeAddr("admin");
    address royaltyReceiver = makeAddr("royalty");
    address payable seedVault = payable(makeAddr("seedVault"));
    address payable treasury = payable(makeAddr("treasury"));
    address payable growth = payable(makeAddr("growth"));
    address teamBeneficiary = makeAddr("teamBeneficiary");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    NeonFaces faces;
    NeonSeeder seeder;
    NeonMinter minter;
    NeonFaceAccount accountImpl;
    VestingWallet teamVesting;
    IERC6551Registry registry = IERC6551Registry(REGISTRY);

    MockStockToken tsla;
    MockStockToken nvda;
    MockStockToken spy;
    MockStockToken usdg;

    uint128 constant PUBLIC_PRICE = 0.02 ether;
    uint128 constant AL_PRICE = 0.012 ether;

    function setUp() public virtual {
        // canonical ERC-6551 registry, runtime bytecode copied from Robinhood Chain mainnet
        vm.etch(REGISTRY, vm.parseBytes(vm.trim(vm.readFile("test/fixtures/erc6551-registry.hex"))));

        accountImpl = new NeonFaceAccount();
        faces = new NeonFaces(admin, royaltyReceiver, "ipfs://unrevealed.json", "ipfs://contract.json");
        seeder = new NeonSeeder(faces, registry, address(accountImpl), admin);
        teamVesting = new VestingWallet(teamBeneficiary, uint64(block.timestamp), 180 days);
        minter = new NeonMinter(faces, seeder, admin, seedVault, treasury, payable(address(teamVesting)), growth);

        tsla = new MockStockToken("Tesla", "TSLA", 18);
        nvda = new MockStockToken("NVIDIA", "NVDA", 18);
        spy = new MockStockToken("SPDR S&P 500", "SPY", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);

        vm.startPrank(admin);
        faces.grantRole(faces.MINTER_ROLE(), address(minter));
        faces.grantRole(faces.PAUSER_ROLE(), admin);
        faces.grantRole(faces.METADATA_ROLE(), admin);
        seeder.grantRole(seeder.CONFIG_ROLE(), admin);

        // baskets
        _basket(1, _legs1(address(tsla), 0.002e18)); // Glance: a sliver of one ticker
        _basket(2, _legs1(address(nvda), 0.003e18));
        _basket(3, _legs2(address(nvda), 0.01e18, address(usdg), 2e6)); // Watch
        _basket(4, _legs2(address(spy), 0.01e18, address(tsla), 0.005e18)); // Heavy Stare
        uint32[] memory g = new uint32[](2);
        g[0] = 1;
        g[1] = 2;
        seeder.setTierBaskets(1, g);
        uint32[] memory w = new uint32[](1);
        w[0] = 3;
        seeder.setTierBaskets(2, w);
        uint32[] memory h = new uint32[](1);
        h[0] = 4;
        seeder.setTierBaskets(3, h);

        minter.configurePhase(NeonMinter.Phase.Public, PUBLIC_PRICE, 5, 0, bytes32(0));
        vm.stopPrank();

        // pre-load the seed pool
        tsla.mint(address(seeder), 1_000e18);
        nvda.mint(address(seeder), 1_000e18);
        spy.mint(address(seeder), 1_000e18);
        usdg.mint(address(seeder), 100_000e6);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _basket(uint32 id, NeonSeeder.Leg[] memory legs) internal {
        seeder.setBasket(id, legs);
    }

    function _legs1(address t, uint256 a) internal pure returns (NeonSeeder.Leg[] memory legs) {
        legs = new NeonSeeder.Leg[](1);
        legs[0] = NeonSeeder.Leg(t, a);
    }

    function _legs2(address t1, uint256 a1, address t2, uint256 a2) internal pure returns (NeonSeeder.Leg[] memory legs) {
        legs = new NeonSeeder.Leg[](2);
        legs[0] = NeonSeeder.Leg(t1, a1);
        legs[1] = NeonSeeder.Leg(t2, a2);
    }

    function _openPublic() internal {
        vm.prank(admin);
        minter.setPhase(NeonMinter.Phase.Public);
    }

    function _mintPublic(address who, uint256 qty) internal returns (uint256 firstId) {
        bytes32[] memory proof;
        vm.prank(who);
        firstId = minter.mint{value: PUBLIC_PRICE * qty}(qty, 0, proof);
    }

    // OpenZeppelin StandardMerkleTree leaf for (address, uint256)
    function _leaf(address who, uint256 allowance) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(who, allowance))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
