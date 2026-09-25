// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonPayout} from "../src/NeonPayout.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551Registry.sol";
import {ISeaDrop, PublicDrop, MintParams, AllowListData} from "../src/interfaces/ISeaDrop.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";

abstract contract Base is Test {
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    /// @dev OpenSea's SeaDrop; runtime bytecode copied from Robinhood Chain mainnet (test/fixtures/seadrop.hex)
    address constant SEADROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    uint16 constant OPENSEA_FEE_BPS = 1_000; // OpenSea keeps 10% of primary sales

    address admin = makeAddr("admin");
    address saleManager = makeAddr("saleManager");
    address openseaFee = makeAddr("openseaFee");
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
    NeonPayout payout;
    NeonFaceAccount accountImpl;
    VestingWallet teamVesting;
    IERC6551Registry registry = IERC6551Registry(REGISTRY);
    ISeaDrop seaDrop = ISeaDrop(SEADROP);

    MockStockToken tsla;
    MockStockToken nvda;
    MockStockToken spy;
    MockStockToken usdg;

    uint80 constant PUBLIC_PRICE = 0.02 ether;
    uint80 constant AL_PRICE = 0.012 ether;

    function setUp() public virtual {
        // canonical ERC-6551 registry and OpenSea SeaDrop, runtime bytecode copied from Robinhood Chain mainnet
        vm.etch(REGISTRY, vm.parseBytes(vm.trim(vm.readFile("test/fixtures/erc6551-registry.hex"))));
        vm.etch(SEADROP, vm.parseBytes(vm.trim(vm.readFile("test/fixtures/seadrop.hex"))));
        vm.store(SEADROP, bytes32(0), bytes32(uint256(1))); // reentrancy guard, as set by its constructor on-chain

        accountImpl = new NeonFaceAccount();
        teamVesting = new VestingWallet(teamBeneficiary, uint64(block.timestamp), 180 days);
        payout = new NeonPayout(seedVault, treasury, payable(address(teamVesting)), growth);
        faces = new NeonFaces(
            admin, royaltyReceiver, address(payout), SEADROP, "ipfs://unrevealed.json", "ipfs://contract.json"
        );
        seeder = new NeonSeeder(faces, registry, address(accountImpl), admin);

        tsla = new MockStockToken("Tesla", "TSLA", 18);
        nvda = new MockStockToken("NVIDIA", "NVDA", 18);
        spy = new MockStockToken("SPDR S&P 500", "SPY", 18);
        usdg = new MockStockToken("Global Dollar", "USDG", 6);

        vm.startPrank(admin);
        faces.setSeeder(address(seeder));
        faces.setSaleManager(saleManager);
        faces.grantRole(faces.PAUSER_ROLE(), admin);
        faces.grantRole(faces.METADATA_ROLE(), admin);
        seeder.grantRole(seeder.CONFIG_ROLE(), admin);

        // baskets: 1-2 = base (every Face, at mint), 3 = Watch top-up, 4 = Heavy Stare top-up (at reveal)
        _basket(1, _legs1(address(tsla), 0.002e18));
        _basket(2, _legs1(address(nvda), 0.003e18));
        _basket(3, _legs2(address(nvda), 0.01e18, address(usdg), 2e6));
        _basket(4, _legs2(address(spy), 0.01e18, address(tsla), 0.005e18));
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
        vm.stopPrank();

        // what OpenSea Studio sets up for every drop: payout address + OpenSea's fee recipient
        vm.startPrank(saleManager);
        faces.updateCreatorPayoutAddress(SEADROP, address(payout));
        faces.updateAllowedFeeRecipient(SEADROP, openseaFee, true);
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

    /// @dev the art commitment every mint requires (tests that upload real chunks commit their own)
    function _commitProvenance() internal {
        if (faces.provenanceHash() != bytes32(0)) return;
        vm.prank(admin);
        faces.setProvenanceHash(keccak256("neonfaces test art"));
    }

    function _publicDrop(uint16 maxPerWallet) internal view returns (PublicDrop memory) {
        return PublicDrop({
            mintPrice: PUBLIC_PRICE,
            startTime: uint48(block.timestamp),
            endTime: uint48(block.timestamp + 7 days),
            maxTotalMintableByWallet: maxPerWallet,
            feeBps: OPENSEA_FEE_BPS,
            restrictFeeRecipients: true
        });
    }

    function _openPublic() internal {
        _openPublic(5);
    }

    function _openPublic(uint16 maxPerWallet) internal {
        _commitProvenance();
        PublicDrop memory drop = _publicDrop(maxPerWallet);
        vm.prank(saleManager);
        faces.updatePublicDrop(SEADROP, drop);
    }

    function _reveal() internal {
        vm.prank(admin);
        faces.requestReveal();
        vm.roll(block.number + 6);
        faces.reveal();
    }

    /// @dev what the OpenSea mint button does
    function _mintPublic(address who, uint256 qty) internal returns (uint256 firstId) {
        firstId = faces.totalSupply() + 1;
        vm.prank(who);
        seaDrop.mintPublic{value: uint256(PUBLIC_PRICE) * qty}(address(faces), openseaFee, address(0), qty);
    }

    /// @dev lets this test contract call `mintSeaDrop` directly (bulk mints without paying)
    function _allowTestAsSeaDrop() internal {
        address[] memory allowed = new address[](2);
        (allowed[0], allowed[1]) = (SEADROP, address(this));
        vm.prank(admin);
        faces.updateAllowedSeaDrop(allowed);
    }

    // ---- SeaDrop allowlists: leaf = keccak256(abi.encode(minter, MintParams)) ----
    function _stage(uint256 price, uint256 maxPerWallet, uint256 stageIndex, uint256 stageSupply)
        internal
        view
        returns (MintParams memory)
    {
        return MintParams({
            mintPrice: price,
            maxTotalMintableByWallet: maxPerWallet,
            startTime: block.timestamp,
            endTime: block.timestamp + 7 days,
            dropStageIndex: stageIndex,
            maxTokenSupplyForStage: stageSupply,
            feeBps: price == 0 ? 0 : OPENSEA_FEE_BPS,
            restrictFeeRecipients: true
        });
    }

    function _leaf(address who, MintParams memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(who, p));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _setAllowList(bytes32 root) internal {
        AllowListData memory data;
        data.merkleRoot = root;
        vm.prank(saleManager);
        faces.updateAllowList(SEADROP, data);
    }
}
