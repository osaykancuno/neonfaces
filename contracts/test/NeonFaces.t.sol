// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";

/// @dev A contract that mints and reverts unless it got a rich tier — the classic re-roll attack.
contract TierSniper {
    NeonMinter immutable minter;
    NeonSeeder immutable seeder;

    constructor(NeonMinter m, NeonSeeder s) {
        minter = m;
        seeder = s;
    }

    function snipe() external payable returns (uint8 tierSeen) {
        bytes32[] memory proof;
        uint256 id = minter.mint{value: msg.value}(1, 0, proof);
        tierSeen = seeder.tierOf(id);
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
        assertEq(address(minter).balance, PUBLIC_PRICE * 3);
    }

    function test_Mint_RequiresProvenance() public {
        vm.prank(admin);
        minter.setPhase(NeonMinter.Phase.Public);
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(NeonFaces.ProvenanceNotSet.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);
    }

    function test_Mint_RevertsWhenClosed() public {
        _commitProvenance();
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(NeonMinter.SaleNotActive.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);
    }

    function test_Mint_WrongPayment() public {
        _openPublic();
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonMinter.WrongPayment.selector, uint256(PUBLIC_PRICE) * 2));
        minter.mint{value: PUBLIC_PRICE}(2, 0, proof);
    }

    function test_Mint_WalletLimitAndMaxPerTx() public {
        _openPublic();
        _mintPublic(alice, 5);
        bytes32[] memory proof;
        vm.prank(alice);
        vm.expectRevert(NeonMinter.WalletLimit.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);

        vm.prank(admin);
        minter.configurePhase(NeonMinter.Phase.Public, PUBLIC_PRICE, 50, 0, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(NeonMinter.InvalidQuantity.selector);
        minter.mint{value: PUBLIC_PRICE * 11}(11, 0, proof);
    }

    function test_Mint_PausedBlocksMintButNotTransfers() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(admin);
        faces.setMintPaused(true);

        bytes32[] memory proof;
        vm.prank(bob);
        vm.expectRevert(NeonFaces.MintIsPaused.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);

        vm.prank(alice);
        faces.transferFrom(alice, bob, 1); // secondary market is never paused
        assertEq(faces.ownerOf(1), bob);
    }

    function test_OnlyMinterCanMint() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, faces.MINTER_ROLE())
        );
        vm.prank(alice);
        faces.mint(alice, 1);
    }

    // ------------------------------------------------------------------
    // Security: tier sniping is impossible
    // ------------------------------------------------------------------
    function test_Security_TierCannotBeSnipedAtMint() public {
        _openPublic();
        TierSniper sniper = new TierSniper(minter, seeder);
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

        bytes32[] memory proof;
        vm.prank(bob);
        vm.expectRevert(NeonFaces.MintIsClosed.selector);
        minter.mint{value: PUBLIC_PRICE}(1, 0, proof);

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
        _grantMinter(address(this));
        for (uint256 i; i < 54; ++i) faces.mint(alice, 100);
        faces.mint(alice, 44);
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

    function testFuzz_PermutationKeyIsCoprime(uint256 seed) public view {
        (uint256 a, uint256 b) = seeder.permutationKey(seed);
        assertTrue(a > 0 && a < 5555 && b < 5555);
        assertTrue(a % 5 != 0 && a % 11 != 0 && a % 101 != 0);
    }

    function test_Reveal_TopUpsForWatchAndHeavy() public {
        _openPublic();
        vm.prank(admin);
        minter.configurePhase(NeonMinter.Phase.Public, PUBLIC_PRICE, 200, 0, bytes32(0));
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
    // Allowlists (Merkle, allowance in leaf)
    // ------------------------------------------------------------------
    function test_BuildersPhase_FreeMintWithProof() public {
        _commitProvenance();
        bytes32 la = _leaf(alice, 2);
        bytes32 lb = _leaf(bob, 1);
        bytes32 root = _hashPair(la, lb);
        vm.startPrank(admin);
        minter.configurePhase(NeonMinter.Phase.Builders, 0, 0, 1111, root);
        minter.setPhase(NeonMinter.Phase.Builders);
        vm.stopPrank();

        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = lb;
        vm.prank(alice);
        minter.mint(2, 2, proofA);
        assertEq(faces.balanceOf(alice), 2);

        vm.prank(alice);
        vm.expectRevert(NeonMinter.WalletLimit.selector);
        minter.mint(1, 2, proofA);

        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = la;
        vm.prank(bob);
        vm.expectRevert(NeonMinter.NotAllowlisted.selector); // forged allowance
        minter.mint(2, 5, proofB);

        vm.prank(carol);
        vm.expectRevert(NeonMinter.NotAllowlisted.selector); // not on list
        minter.mint(1, 1, proofB);

        vm.prank(bob);
        minter.mint(1, 1, proofB);
        assertEq(faces.balanceOf(bob), 1);
    }

    function test_PhaseSupplyCap() public {
        _commitProvenance();
        bytes32 la = _leaf(alice, 5);
        bytes32 lb = _leaf(bob, 5);
        vm.startPrank(admin);
        minter.configurePhase(NeonMinter.Phase.Allowlist, AL_PRICE, 0, 6, _hashPair(la, lb));
        minter.setPhase(NeonMinter.Phase.Allowlist);
        vm.stopPrank();
        bytes32[] memory pa = new bytes32[](1);
        pa[0] = lb;
        bytes32[] memory pb = new bytes32[](1);
        pb[0] = la;
        vm.prank(alice);
        minter.mint{value: AL_PRICE * 5}(5, 5, pa);
        vm.prank(bob);
        vm.expectRevert(NeonMinter.PhaseSoldOut.selector);
        minter.mint{value: AL_PRICE * 2}(2, 5, pb);
        vm.prank(bob);
        minter.mint{value: AL_PRICE}(1, 5, pb);
    }

    function test_FinishedIsTerminal() public {
        vm.startPrank(admin);
        minter.setPhase(NeonMinter.Phase.Finished);
        vm.expectRevert(NeonMinter.PhaseFinished.selector);
        minter.setPhase(NeonMinter.Phase.Public);
        vm.stopPrank();
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

        uint256[] memory ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (1, 2, 111);
        vm.prank(carol); // team faces are activated permissionlessly
        seeder.activateBatch(ids);
        assertTrue(seeder.seedOf(111).funded);
    }

    function test_PublicCapReservesTeamAllocation() public {
        _commitProvenance();
        _grantMinter(address(this));
        for (uint256 i; i < 54; ++i) faces.mint(alice, 100);
        faces.mint(alice, 44);
        assertEq(faces.publicMinted(), 5444);
        vm.expectRevert(NeonFaces.ExceedsPublicAllocation.selector);
        faces.mint(alice, 1);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        assertEq(faces.totalSupply(), faces.MAX_SUPPLY());
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
        vm.prank(admin);
        vm.expectRevert(NeonFaces.RoyaltyTooHigh.selector);
        faces.setDefaultRoyalty(royaltyReceiver, 501);
    }

    function test_SupportsInterfaces() public view {
        assertTrue(faces.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(faces.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(faces.supportsInterface(0x49064906)); // ERC4906
        assertEq(faces.owner(), admin); // OpenSea collection owner
    }

    // ------------------------------------------------------------------
    // Proceeds split 40 / 25 / 20 / 15 + team vesting
    // ------------------------------------------------------------------
    function test_Split_ReleaseAll() public {
        _openPublic();
        _mintPublic(alice, 5);
        _mintPublic(bob, 5);
        uint256 total = PUBLIC_PRICE * 10;

        vm.prank(carol); // anyone can push
        minter.releaseAll();
        assertEq(seedVault.balance, total * 40 / 100);
        assertEq(treasury.balance, total * 25 / 100);
        assertEq(address(teamVesting).balance, total * 20 / 100);
        assertEq(growth.balance, total * 15 / 100);
        assertEq(address(minter).balance, 0);

        _mintPublic(carol, 1);
        minter.release(seedVault);
        assertEq(seedVault.balance, (total + PUBLIC_PRICE) * 40 / 100);
        assertEq(minter.releasable(treasury), uint256(PUBLIC_PRICE) * 25 / 100);
        assertEq(minter.releasable(alice), 0);
    }

    function test_TeamVesting_Linear6Months() public {
        _openPublic();
        _mintPublic(alice, 5);
        minter.releaseAll();
        uint256 teamTotal = address(teamVesting).balance;
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertApproxEqAbs(teamBeneficiary.balance, teamTotal / 2, 1);
        vm.warp(block.timestamp + 90 days);
        teamVesting.release();
        assertEq(teamBeneficiary.balance, teamTotal);
    }

    function test_Minter_RejectsDuplicatePayees() public {
        vm.expectRevert(NeonMinter.DuplicatePayee.selector);
        new NeonMinter(faces, seeder, admin, seedVault, seedVault, growth, treasury);
    }
}
