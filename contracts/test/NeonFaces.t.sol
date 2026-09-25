// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonPayout} from "../src/NeonPayout.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {
    ISeaDrop,
    INonFungibleSeaDropToken,
    ISeaDropTokenContractMetadata,
    PublicDrop,
    MintParams,
    MultiConfigureStruct,
    TokenGatedDropStage,
    SignedMintValidationParams,
    RoyaltyInfo
} from "../src/interfaces/ISeaDrop.sol";

/// @dev A contract that mints on OpenSea and reverts unless it got a rich tier — the classic re-roll attack.
contract TierSniper {
    ISeaDrop immutable seaDrop;
    NeonFaces immutable faces;
    NeonSeeder immutable seeder;
    address immutable feeRecipient;

    constructor(ISeaDrop sd, NeonFaces f, NeonSeeder s, address fee) {
        seaDrop = sd;
        faces = f;
        seeder = s;
        feeRecipient = fee;
    }

    function snipe() external payable returns (uint8 tierSeen) {
        seaDrop.mintPublic{value: msg.value}(address(faces), feeRecipient, address(0), 1);
        tierSeen = seeder.tierOf(faces.totalSupply());
        if (tierSeen < 3) revert("not heavy, re-roll");
    }
}

contract NeonFacesTest is Base {
    // ------------------------------------------------------------------
    // Mint flow: NFT + account + base seed in one transaction
    // ------------------------------------------------------------------
    function test_PublicMint_CreatesAccountAndBaseSeed() public {
        _openPublic();
        uint256 first = _mintPublic(alice, 3);
        assertEq(first, 1);
        assertEq(faces.totalSupply(), 3);

        for (uint256 id = 1; id <= 3; ++id) {
            assertEq(faces.ownerOf(id), alice);
            NeonSeeder.SeedView memory s = seeder.seedOf(id);
            assertTrue(s.activated);
            assertTrue(s.funded, "never born empty");
            assertEq(s.tier, 0, "tier unknowable before reveal");
            assertGt(s.account.code.length, 0, "account deployed");
            assertEq(s.account, registry.account(address(accountImpl), bytes32(0), block.chainid, address(faces), id));
            assertEq(NeonFaceAccount(payable(s.account)).owner(), alice);
            for (uint256 j; j < s.legs.length; ++j) {
                assertEq(IERC20(s.legs[j].token).balanceOf(s.account), s.legs[j].amount);
            }
        }
        assertEq(seeder.fundedCount(), 3);
        // OpenSea keeps its fee, the rest can only land in the immutable split
        assertEq(openseaFee.balance, uint256(PUBLIC_PRICE) * 3 / 10);
        assertEq(address(payout).balance, uint256(PUBLIC_PRICE) * 3 * 9 / 10);
    }

    function test_Mint_RequiresProvenance() public {
        PublicDrop memory drop = _publicDrop(5);
        vm.prank(saleManager);
        faces.updatePublicDrop(SEADROP, drop);
        vm.prank(alice);
        vm.expectRevert(NeonFaces.ProvenanceNotSet.selector);
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 1);
    }

    function test_Mint_RequiresSeeder() public {
        NeonFaces bare = new NeonFaces(admin, royaltyReceiver, address(payout), SEADROP, "", "");
        vm.startPrank(admin);
        bare.setProvenanceHash(keccak256("art"));
        vm.expectRevert(NeonFaces.SeederNotSet.selector);
        bare.teamMint(admin, 1);
        vm.expectRevert(NeonFaces.SeederMismatch.selector); // a seeder wired to another collection
        bare.setSeeder(address(seeder));
        vm.stopPrank();
    }

    function test_Mint_NotBeforeTheDropStarts() public {
        _commitProvenance();
        vm.prank(alice);
        vm.expectRevert(); // SeaDrop: NotActive (no public stage configured)
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 1);
    }

    function test_Mint_WrongPayment() public {
        _openPublic();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("IncorrectPayment(uint256,uint256)", PUBLIC_PRICE, PUBLIC_PRICE * 2));
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 2);
    }

    function test_Mint_WalletLimit() public {
        _openPublic();
        _mintPublic(alice, 5);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MintQuantityExceedsMaxMintedPerWallet(uint256,uint256)", 6, 5));
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 1);
        assertEq(faces.seaDropMinted(alice), 5);
    }

    function test_Mint_OnlyOpenSeaFeeRecipient() public {
        _openPublic();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("FeeRecipientNotAllowed()"));
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), alice, address(0), 1);
    }

    function test_Mint_PausedBlocksMintButNotTransfers() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(admin);
        faces.setMintPaused(true);

        vm.prank(bob);
        vm.expectRevert(NeonFaces.MintIsPaused.selector);
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 1);

        vm.prank(alice);
        faces.transferFrom(alice, bob, 1); // secondary market is never paused
        assertEq(faces.ownerOf(1), bob);
    }

    function test_OnlySeaDropCanMint() public {
        _commitProvenance();
        vm.expectRevert(NeonFaces.OnlyAllowedSeaDrop.selector);
        vm.prank(alice);
        faces.mintSeaDrop(alice, 1);
    }

    // ------------------------------------------------------------------
    // Security: tier sniping is impossible
    // ------------------------------------------------------------------
    function test_Security_TierCannotBeSnipedAtMint() public {
        _openPublic(50);
        TierSniper sniper = new TierSniper(seaDrop, faces, seeder, openseaFee);
        vm.deal(address(sniper), 1 ether);
        // the tier is 0 (unknowable) inside the mint tx: a re-roll contract can never see a rich tier
        for (uint256 i; i < 5; ++i) {
            vm.expectRevert(bytes("not heavy, re-roll"));
            sniper.snipe{value: PUBLIC_PRICE}();
            vm.roll(block.number + 1);
        }
    }

    function test_Security_MintClosesForeverAtRevealRequest() public {
        _openPublic();
        _mintPublic(alice, 2);
        vm.prank(admin);
        faces.requestReveal();
        assertTrue(faces.mintClosed());

        // SeaDrop already refuses (the reported supply is final), and the token refuses on its own
        assertEq(faces.maxSupply(), 2, "OpenSea sees the final supply");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("MintQuantityExceedsMaxSupply(uint256,uint256)", 3, 2));
        seaDrop.mintPublic{value: PUBLIC_PRICE}(address(faces), openseaFee, address(0), 1);
        _allowTestAsSeaDrop();
        vm.expectRevert(NeonFaces.MintIsClosed.selector);
        faces.mintSeaDrop(bob, 1);

        vm.prank(admin);
        vm.expectRevert(NeonFaces.MintIsClosed.selector);
        faces.teamMint(admin, 1);
    }

    function test_Security_RevealCannotBeReRequestedWhileOpen() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.startPrank(admin);
        faces.requestReveal();
        vm.expectRevert(NeonFaces.RevealStillOpen.selector); // target not mined yet
        faces.requestReveal();
        vm.roll(block.number + 10);
        vm.expectRevert(NeonFaces.RevealStillOpen.selector); // hash still usable: reveal() it
        faces.requestReveal();
        vm.roll(block.number + 300); // window missed
        faces.requestReveal();
        vm.stopPrank();
        assertEq(faces.revealRequests(), 2, "re-requests are counted on-chain");
    }

    // ------------------------------------------------------------------
    // Reveal: keyed permutation -> art + exact tiers, then top-ups
    // ------------------------------------------------------------------
    function test_Reveal_FullSupplyPermutationIsExact() public {
        _commitProvenance();
        _allowTestAsSeaDrop();
        for (uint256 i; i < 54; ++i) faces.mintSeaDrop(alice, 100);
        faces.mintSeaDrop(alice, 44);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        _reveal();

        bool[] memory used = new bool[](5555);
        uint256[4] memory count;
        for (uint256 id = 1; id <= 5555; ++id) {
            uint256 art = seeder.artIdOf(id);
            assertLt(art, 5555);
            assertFalse(used[art], "art assigned twice");
            used[art] = true;
            ++count[seeder.tierOf(id)];
        }
        assertEq(count[1], 4444);
        assertEq(count[2], 833);
        assertEq(count[3], 278);
    }

    function testFuzz_RevealKeyIsABijectionKey(uint256 seed, uint256 n) public view {
        n = bound(n, 1, 5555);
        (uint256 a, uint256 b, uint256 inv) = seeder.revealKey(seed, n);
        assertTrue(a > 0 && (n == 1 || a < n) && b < n);
        assertEq(mulmod(a, inv, n), 1 % n, "a is invertible mod n");
        if (n >= 256) {
            for (uint256 k = 1; k < 4; ++k) {
                uint256 r = (k * inv) % n;
                assertTrue(r > n / 64 && n - r > n / 64, "set members are far apart");
            }
        }
    }

    function test_Reveal_TopUpsForWatchAndHeavy() public {
        _openPublic(200);
        for (uint256 i; i < 12; ++i) _mintPublic(alice, 10);
        assertEq(seeder.upgradedCount(), 0);

        uint256[] memory ids = new uint256[](120);
        for (uint256 i; i < 120; ++i) ids[i] = i + 1;
        assertEq(seeder.upgradeBatch(ids), 0, "nothing to upgrade before reveal");

        _reveal();
        uint256 eligible;
        for (uint256 id = 1; id <= 120; ++id) if (seeder.tierOf(id) >= 2) ++eligible;
        assertGt(eligible, 0);

        vm.prank(carol); // permissionless
        uint256 done = seeder.upgradeBatch(ids);
        assertEq(done, eligible);
        assertEq(seeder.upgradeBatch(ids), 0, "idempotent");

        for (uint256 id = 1; id <= 120; ++id) {
            NeonSeeder.SeedView memory s = seeder.seedOf(id);
            if (s.tier >= 2) {
                assertTrue(s.upgraded);
                for (uint256 j; j < s.upgradeLegs.length; ++j) {
                    assertGe(IERC20(s.upgradeLegs[j].token).balanceOf(s.account), s.upgradeLegs[j].amount);
                }
            } else {
                assertFalse(s.upgraded);
                vm.expectRevert(abi.encodeWithSelector(NeonSeeder.NotUpgradeable.selector, id));
                seeder.upgrade(id);
            }
        }
    }

    // ------------------------------------------------------------------
    // OpenSea allowlist stages (SeaDrop Merkle: stage terms are in the leaf)
    // ------------------------------------------------------------------
    function test_BuildersStage_FreeMintWithProof() public {
        _commitProvenance();
        MintParams memory builders = _stage(0, 2, 1, 1111);
        bytes32 la = _leaf(alice, builders);
        bytes32 lb = _leaf(bob, builders);
        _setAllowList(_hashPair(la, lb));

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        seaDrop.mintAllowList(address(faces), openseaFee, address(0), 2, builders, proofA);
        assertEq(faces.balanceOf(alice), 2);
        assertTrue(seeder.seedOf(1).funded, "free Faces are seeded too");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MintQuantityExceedsMaxMintedPerWallet(uint256,uint256)", 3, 2));
        seaDrop.mintAllowList(address(faces), openseaFee, address(0), 1, builders, proofA);

        MintParams memory forged = _stage(0, 5, 1, 1111);
        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = la;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("InvalidProof()")); // forged terms
        seaDrop.mintAllowList(address(faces), openseaFee, address(0), 1, forged, proofB);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSignature("InvalidProof()")); // not on the list
        seaDrop.mintAllowList(address(faces), openseaFee, address(0), 1, builders, proofB);

        vm.prank(bob);
        seaDrop.mintAllowList(address(faces), openseaFee, address(0), 1, builders, proofB);
        assertEq(faces.balanceOf(bob), 1);
        assertEq(address(payout).balance, 0, "free stage: nothing paid");
    }

    function test_AllowlistStage_SupplyCapAndPaidSplit() public {
        _commitProvenance();
        MintParams memory al = _stage(AL_PRICE, 5, 2, 6); // stage closes at total supply 6
        bytes32 la = _leaf(alice, al);
        bytes32 lb = _leaf(bob, al);
        _setAllowList(_hashPair(la, lb));
        bytes32[] memory pa = new bytes32[](1);
        pa[0] = lb;
        bytes32[] memory pb = new bytes32[](1);
        pb[0] = la;

        vm.prank(alice);
        seaDrop.mintAllowList{value: uint256(AL_PRICE) * 5}(address(faces), openseaFee, address(0), 5, al, pa);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("MintQuantityExceedsMaxTokenSupplyForStage(uint256,uint256)", 7, 6));
        seaDrop.mintAllowList{value: uint256(AL_PRICE) * 2}(address(faces), openseaFee, address(0), 2, al, pb);
        vm.prank(bob);
        seaDrop.mintAllowList{value: AL_PRICE}(address(faces), openseaFee, address(0), 1, al, pb);
        assertEq(address(payout).balance, uint256(AL_PRICE) * 6 * 9 / 10);
    }

    // ------------------------------------------------------------------
    // OpenSea Studio configuration: what the sale manager can and cannot do
    // ------------------------------------------------------------------
    function test_Studio_MultiConfigure() public {
        _commitProvenance();
        MultiConfigureStruct memory c;
        c.maxSupply = 10_000; // ignored: supply is fixed in bytecode
        c.baseURI = "https://evil.example/"; // ignored: art is on-chain
        c.seaDropImpl = SEADROP;
        c.publicDrop = _publicDrop(3);
        c.dropURI = "https://opensea.io/drop";
        c.creatorPayoutAddress = address(payout);
        c.allowedFeeRecipients = new address[](1);
        c.allowedFeeRecipients[0] = makeAddr("otherFeeRecipient");
        vm.prank(saleManager);
        faces.multiConfigure(c);

        assertEq(seaDrop.getCreatorPayoutAddress(address(faces)), address(payout));
        assertEq(seaDrop.getPublicDrop(address(faces)).maxTotalMintableByWallet, 3);
        assertEq(faces.maxSupply(), faces.PUBLIC_CAP());
        assertEq(faces.baseURI(), "");
        _mintPublic(alice, 3);
        assertEq(faces.balanceOf(alice), 3);
    }

    function test_Studio_PayoutCanOnlyBeTheSplit() public {
        vm.startPrank(saleManager);
        vm.expectRevert(NeonFaces.PayoutIsFixed.selector);
        faces.updateCreatorPayoutAddress(SEADROP, saleManager);

        MultiConfigureStruct memory c;
        c.seaDropImpl = SEADROP;
        c.creatorPayoutAddress = saleManager;
        vm.expectRevert(NeonFaces.PayoutIsFixed.selector);
        faces.multiConfigure(c);
        vm.stopPrank();
        assertEq(seaDrop.getCreatorPayoutAddress(address(faces)), address(payout));
    }

    function test_Studio_SaleManagerPowersAreNarrow() public {
        assertEq(faces.owner(), saleManager, "OpenSea Studio sees the sale manager as owner");
        vm.startPrank(saleManager);
        address[] memory evil = new address[](1);
        evil[0] = saleManager;
        vm.expectRevert(); // cannot let itself mint
        faces.updateAllowedSeaDrop(evil);
        vm.expectRevert();
        faces.teamMint(saleManager, 1);
        vm.expectRevert();
        faces.setRoyaltyInfo(RoyaltyInfo(saleManager, 500));
        vm.expectRevert(NeonFaces.OnlyAllowedSeaDrop.selector); // only the allowed SeaDrop is configured
        faces.updatePublicDrop(alice, _publicDrop(5));
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(NeonFaces.OnlySaleManager.selector);
        faces.updatePublicDrop(SEADROP, _publicDrop(5));

        vm.prank(admin);
        faces.setSaleManager(address(0)); // after the sale: the Safe is the owner again
        assertEq(faces.owner(), admin);
        vm.prank(saleManager);
        vm.expectRevert(NeonFaces.OnlySaleManager.selector);
        faces.updatePublicDrop(SEADROP, _publicDrop(5));
    }

    function test_Studio_FeesCannotRouteMoneyAroundThePayout() public {
        // the attack: allow your own fee recipient, set a 100% fee, mint directly on SeaDrop with it
        PublicDrop memory drop = _publicDrop(5);
        drop.feeBps = 10_000;
        vm.startPrank(saleManager);
        vm.expectRevert(NeonFaces.FeeNotAllowed.selector);
        faces.updatePublicDrop(SEADROP, drop);

        drop.feeBps = 1_000;
        drop.restrictFeeRecipients = false; // any minter could name itself fee recipient
        vm.expectRevert(NeonFaces.FeeNotAllowed.selector);
        faces.updatePublicDrop(SEADROP, drop);

        MultiConfigureStruct memory c;
        c.seaDropImpl = SEADROP;
        c.publicDrop = _publicDrop(5);
        c.publicDrop.feeBps = 5_000;
        vm.expectRevert(NeonFaces.FeeNotAllowed.selector);
        faces.multiConfigure(c);

        TokenGatedDropStage memory gated;
        gated.maxTotalMintableByWallet = 1;
        gated.feeBps = 2_000;
        gated.restrictFeeRecipients = true;
        vm.expectRevert(NeonFaces.FeeNotAllowed.selector);
        faces.updateTokenGatedDrop(SEADROP, address(tsla), gated);

        SignedMintValidationParams memory signed;
        signed.maxFeeBps = 10_000;
        vm.expectRevert(NeonFaces.FeeNotAllowed.selector);
        faces.updateSignedMintValidationParams(SEADROP, saleManager, signed);

        // OpenSea's own terms pass
        faces.updatePublicDrop(SEADROP, _publicDrop(5));
        vm.stopPrank();
    }

    function test_SeaDropInterfaces() public view {
        // SeaDrop only accepts configuration from contracts reporting these ids (checked by the real
        // bytecode in every update above); the values are the upstream ones
        assertEq(type(INonFungibleSeaDropToken).interfaceId, bytes4(0x1890fe8e));
        assertEq(type(ISeaDropTokenContractMetadata).interfaceId, bytes4(0x9c154415));
        assertTrue(faces.supportsInterface(0x1890fe8e));
        assertTrue(faces.supportsInterface(0x9c154415));
        (uint256 minted, uint256 supply, uint256 max) = faces.getMintStats(alice);
        assertEq(minted + supply, 0);
        assertEq(max, 5444, "the unminted team reserve is not for sale");
    }

    function test_SetMaxSupplyReverts() public {
        vm.prank(admin);
        vm.expectRevert(NeonFaces.SupplyIsFixed.selector);
        faces.setMaxSupply(6000);
    }

    // ------------------------------------------------------------------
    // Supply caps in bytecode
    // ------------------------------------------------------------------
    function test_TeamMintCappedAt111() public {
        _commitProvenance();
        vm.startPrank(admin);
        faces.teamMint(admin, 100);
        faces.teamMint(admin, 11);
        vm.expectRevert(NeonFaces.ExceedsTeamAllocation.selector);
        faces.teamMint(admin, 1);
        vm.stopPrank();
        assertEq(faces.teamMinted(), 111);
        assertTrue(seeder.seedOf(1).funded, "team Faces get account + seed at mint too");
        assertTrue(seeder.seedOf(111).funded);
    }

    function test_PublicCapReservesTeamAllocation() public {
        _commitProvenance();
        _allowTestAsSeaDrop();
        vm.prank(admin);
        faces.teamMint(admin, 11);
        assertEq(faces.maxSupply(), 5455, "team Faces already minted count toward the supply");
        for (uint256 i; i < 54; ++i) faces.mintSeaDrop(alice, 100);
        faces.mintSeaDrop(alice, 44);
        assertEq(faces.publicMinted(), 5444);
        vm.expectRevert(NeonFaces.ExceedsPublicAllocation.selector);
        faces.mintSeaDrop(alice, 1);
        vm.prank(admin);
        faces.teamMint(admin, 100);
        assertEq(faces.totalSupply(), faces.MAX_SUPPLY());
        assertEq(faces.maxSupply(), faces.MAX_SUPPLY());
    }

    // ------------------------------------------------------------------
    // Seeds: pending seeds, compliance-blocked tokens, config lock
    // ------------------------------------------------------------------
    function test_PendingSeed_WhenPoolEmpty_ThenFund() public {
        vm.startPrank(admin);
        seeder.withdrawPool(address(tsla), admin, tsla.balanceOf(address(seeder)));
        seeder.withdrawPool(address(nvda), admin, nvda.balanceOf(address(seeder)));
        vm.stopPrank();

        _openPublic();
        _mintPublic(alice, 2); // mint must not revert
        NeonSeeder.SeedView memory s = seeder.seedOf(1);
        assertTrue(s.activated);
        assertFalse(s.funded);

        tsla.mint(address(seeder), 10e18);
        nvda.mint(address(seeder), 10e18);
        vm.prank(carol);
        seeder.fund(1);
        assertTrue(seeder.seedOf(1).funded);

        vm.expectRevert(NeonSeeder.AlreadyFunded.selector);
        seeder.fund(1);
    }

    function test_ComplianceBlockedToken_DoesNotBreakMint() public {
        tsla.setRestricted(true);
        nvda.setRestricted(true);
        _openPublic();
        _mintPublic(alice, 3);
        assertEq(faces.balanceOf(alice), 3);
        assertEq(seeder.fundedCount(), 0);
    }

    function test_Seeder_ConfigLock() public {
        vm.prank(admin);
        seeder.lockConfig();
        vm.prank(admin);
        vm.expectRevert(NeonSeeder.ConfigIsLocked.selector);
        seeder.setBasket(1, _legs1(address(tsla), 1));
    }

    function test_Seeder_FundFromSelfOnlySelf() public {
        vm.expectRevert(NeonSeeder.OnlySelf.selector);
        seeder.fundFromSelf(1, alice);
    }

    function test_Activate_NonexistentReverts() public {
        vm.expectRevert();
        seeder.activate(42);
    }

    function test_Activate_Idempotent() public {
        _openPublic();
        _mintPublic(alice, 1);
        uint256 bal = tsla.balanceOf(address(seeder)) + nvda.balanceOf(address(seeder));
        seeder.activate(1);
        seeder.activate(1);
        assertEq(tsla.balanceOf(address(seeder)) + nvda.balanceOf(address(seeder)), bal, "no double funding");
        assertEq(seeder.activatedCount(), 1);
    }

    // ------------------------------------------------------------------
    // Provenance, metadata, royalties
    // ------------------------------------------------------------------
    function test_Provenance_OnceOnly() public {
        vm.startPrank(admin);
        faces.setProvenanceHash(keccak256("art"));
        vm.expectRevert(NeonFaces.ProvenanceAlreadySet.selector);
        faces.setProvenanceHash(keccak256("other"));
        vm.stopPrank();
    }

    function test_TokenURI_UnrevealedThenBaseThenFrozen() public {
        _openPublic();
        _mintPublic(alice, 1);
        assertEq(faces.tokenURI(1), "ipfs://unrevealed.json");
        vm.startPrank(admin);
        faces.setBaseURI("ipfs://cid/");
        assertEq(faces.tokenURI(1), "ipfs://cid/1");
        faces.freezeMetadata();
        vm.expectRevert(NeonFaces.MetadataIsFrozen.selector);
        faces.setBaseURI("ipfs://evil/");
        vm.stopPrank();
    }

    function test_Royalty5PercentCapped() public {
        (address recv, uint256 amt) = faces.royaltyInfo(1, 1 ether);
        assertEq(recv, royaltyReceiver);
        assertEq(amt, 0.05 ether);
        assertEq(faces.royaltyAddress(), royaltyReceiver);
        assertEq(faces.royaltyBasisPoints(), 500);
        vm.prank(admin);
        vm.expectRevert(NeonFaces.RoyaltyTooHigh.selector);
        faces.setRoyaltyInfo(RoyaltyInfo(royaltyReceiver, 501));
    }

    function test_SupportsInterfaces() public view {
        assertTrue(faces.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(faces.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(faces.supportsInterface(0x49064906)); // ERC4906
    }

    // ------------------------------------------------------------------
    // Proceeds split 40 / 25 / 20 / 15 + team vesting
    // ------------------------------------------------------------------
    function test_Split_ReleaseAll() public {
        _openPublic();
        _mintPublic(alice, 5);
        _mintPublic(bob, 5);
        uint256 total = uint256(PUBLIC_PRICE) * 10 * 9 / 10; // after OpenSea's 10%

        vm.prank(carol); // anyone can push
        payout.releaseAll();
        assertEq(seedVault.balance, total * 40 / 100);
        assertEq(treasury.balance, total * 25 / 100);
        assertEq(address(teamVesting).balance, total * 20 / 100);
        assertEq(growth.balance, total * 15 / 100);
        assertEq(address(payout).balance, 0);

        _mintPublic(carol, 1);
        uint256 net = uint256(PUBLIC_PRICE) * 9 / 10;
        payout.release(seedVault);
        assertEq(seedVault.balance, (total + net) * 40 / 100);
        assertEq(payout.releasable(treasury), net * 25 / 100);
        assertEq(payout.releasable(alice), 0);
    }

    function test_TeamVesting_Linear6Months() public {
        _openPublic();
        _mintPublic(alice, 5);
        payout.releaseAll();
        uint256 teamTotal = address(teamVesting).balance;
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertApproxEqAbs(teamBeneficiary.balance, teamTotal / 2, 1);
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertEq(teamBeneficiary.balance, teamTotal);
    }

    function test_Payout_RejectsDuplicatePayees() public {
        vm.expectRevert(NeonPayout.DuplicatePayee.selector);
        new NeonPayout(seedVault, seedVault, growth, treasury);
    }
}
