// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";

/// @notice Sets of four: the reveal hands out whole sets only, assembly, the one-time bonus, and the
/// ownership-cycle guard that keeps nested Faces movable.
contract SetsTest is Base {
    function _mintAndReveal(uint256 n) internal {
        _commitProvenance();
        _allowTestAsSeaDrop();
        while (faces.totalSupply() < n) {
            uint256 left = n - faces.totalSupply();
            faces.mintSeaDrop(alice, left > 100 ? 100 : left);
        }
        _reveal();
    }

    function _firstSet(uint256 n) internal view returns (uint256 setId, uint256[4] memory members) {
        for (uint256 id = 1; id <= n; ++id) {
            (setId,, members) = seeder.setOf(id);
            if (setId != 0) return (setId, members);
        }
        revert("no set");
    }

    function _dist(uint256 x, uint256 y, uint256 n) internal pure returns (uint256 d) {
        d = x > y ? x - y : y - x;
        if (n - d < d) d = n - d;
    }

    // ------------------------------------------------------------------
    // Reveal: whole sets only
    // ------------------------------------------------------------------
    function test_Sets_SellOutHandsOutAll555CompleteSets() public {
        _commitProvenance();
        _allowTestAsSeaDrop();
        for (uint256 i; i < 54; ++i) faces.mintSeaDrop(alice, 100);
        faces.mintSeaDrop(alice, 44);
        vm.prank(admin);
        faces.teamMint(admin, 111);
        _reveal();
        uint256[556] memory seen;
        uint256 pieces;
        for (uint256 id = 1; id <= 5555; ++id) {
            (uint256 setId, uint256 piece, uint256[4] memory m) = seeder.setOf(id);
            if (setId == 0) {
                assertLt(seeder.artIdOf(id), 3335, "singles use single art");
                continue;
            }
            ++pieces;
            ++seen[setId];
            assertEq(m[piece], id, "a Face is its own piece");
            assertEq(seeder.artIdOf(id), 3335 + 4 * (setId - 1) + piece, "piece art");
            uint8 tier = seeder.tierOf(m[0]);
            for (uint256 q; q < 4; ++q) {
                assertEq(seeder.tierOf(m[q]), tier, "a set shares its tier");
                for (uint256 r = q + 1; r < 4; ++r) {
                    assertGt(_dist(m[q], m[r], 5555), uint256(86), "no set from a run of consecutive ids");
                }
            }
        }
        assertEq(pieces, 2220);
        for (uint256 s = 1; s <= 555; ++s) assertEq(seen[s], 4, "every set complete");
    }

    function testFuzz_Sets_PartialSaleOnlyWholeSets(uint256 n) public {
        n = bound(n, 1, 700);
        _mintAndReveal(n);
        uint256 pieces;
        for (uint256 id = 1; id <= n; ++id) {
            (uint256 setId, uint256 piece, uint256[4] memory m) = seeder.setOf(id);
            if (setId == 0) continue;
            ++pieces;
            for (uint256 q; q < 4; ++q) {
                assertTrue(m[q] >= 1 && m[q] <= n, "every piece of a handed-out set was minted");
                (uint256 s2, uint256 p2,) = seeder.setOf(m[q]);
                assertEq(s2, setId);
                assertEq(p2, q);
            }
            assertEq(m[piece], id);
        }
        assertEq(pieces, 4 * seeder.setsIn(n));
    }

    function test_Sets_NothingBeforeReveal() public {
        _openPublic();
        _mintPublic(alice, 3);
        (uint256 setId,,) = seeder.setOf(1);
        assertEq(setId, 0);
        assertFalse(seeder.isAssembled(1));
    }

    // ------------------------------------------------------------------
    // Assembly + bonus
    // ------------------------------------------------------------------
    function _assemble(uint256[4] memory m, uint256 anchor) internal returns (address acc) {
        acc = seeder.accountOf(anchor);
        vm.startPrank(faces.ownerOf(anchor));
        for (uint256 q; q < 4; ++q) {
            if (m[q] != anchor) faces.safeTransferFrom(faces.ownerOf(m[q]), acc, m[q]);
        }
        vm.stopPrank();
    }

    function test_Sets_AssembleClaimBonusOnceThenTakeApart() public {
        _mintAndReveal(120);
        (uint256 setId, uint256[4] memory m) = _firstSet(120);
        assertFalse(seeder.isAssembled(m[0]));
        assertFalse(seeder.setBonusDue(m[0]));
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetNotAssembled.selector, m[0]));
        seeder.claimSetBonus(m[0]);

        address acc = seeder.accountOf(m[0]);
        uint256 before = spy.balanceOf(acc);
        vm.startPrank(alice);
        faces.safeTransferFrom(alice, acc, m[1]);
        faces.safeTransferFrom(alice, acc, m[2]);
        assertEq(spy.balanceOf(acc), before, "no bonus before the last piece");
        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(m[0]); // marketplaces see the bonus at once
        faces.safeTransferFrom(alice, acc, m[3]); // the last piece: the bonus comes in the same transaction
        vm.stopPrank();
        assertTrue(seeder.isAssembled(m[0]));
        assertFalse(seeder.isAssembled(m[1]), "only the anchor is assembled");
        assertFalse(seeder.setBonusDue(m[0]));
        assertEq(spy.balanceOf(acc) - before, 0.013e18);
        assertEq(usdg.balanceOf(acc), 3e6);
        (uint32 anchorId, uint32 basketId) = seeder.setBonus(setId);
        assertEq(anchorId, m[0]);
        assertEq(basketId, 5);
        assertEq(seeder.setBonusCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetBonusAlreadyPaid.selector, setId));
        seeder.claimSetBonus(m[0]);

        // the holder takes the set apart through the anchor's account...
        vm.startPrank(alice);
        for (uint256 q = 1; q < 4; ++q) {
            NeonFaceAccount(payable(acc)).execute(
                address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[q])), 0
            );
        }
        vm.stopPrank();
        assertFalse(seeder.isAssembled(m[0]));
        // ...and assembling it again around another piece earns nothing more
        _assemble(m, m[3]);
        assertTrue(seeder.isAssembled(m[3]));
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetBonusAlreadyPaid.selector, setId));
        seeder.claimSetBonus(m[3]);
    }

    function test_Sets_ShortPoolNeverBlocksAssembly() public {
        _mintAndReveal(120);
        (uint256 setId, uint256[4] memory m) = _firstSet(120);
        vm.startPrank(admin);
        seeder.withdrawPool(address(spy), admin, spy.balanceOf(address(seeder))); // the pool can't pay the bonus
        vm.stopPrank();
        _assemble(m, m[0]); // the transfers still go through
        assertTrue(seeder.isAssembled(m[0]));
        assertTrue(seeder.setBonusDue(m[0]), "still owed");
        // a Face from another set moving in doesn't retry the claim, nor need its gas budget
        uint256 other = 1;
        while (other == m[0] || other == m[1] || other == m[2] || other == m[3]) ++other;
        address acc = seeder.accountOf(m[0]);
        vm.prank(alice);
        (bool ok,) = address(faces).call{gas: 400_000}(abi.encodeCall(faces.transferFrom, (alice, acc, other)));
        assertTrue(ok, "unrelated move needs no bonus budget");
        (uint32 anchorId,) = seeder.setBonus(setId);
        assertEq(anchorId, 0);
        spy.mint(address(seeder), 1e18); // restocked: anyone (the keeper, the site's button) delivers it
        vm.prank(carol);
        seeder.claimSetBonus(m[0]);
        assertFalse(seeder.setBonusDue(m[0]));
    }

    /// Whatever gas the last transfer gets, it either pays the bonus or reverts: a wallet's gas estimate can never
    /// land on a limit where the piece moves in and the bonus is quietly skipped.
    function test_Sets_LastPieceNeverSkipsTheBonusForLackOfGas() public {
        _mintAndReveal(120);
        (uint256 setId, uint256[4] memory m) = _firstSet(120);
        address acc = seeder.accountOf(m[0]);
        vm.startPrank(alice);
        faces.transferFrom(alice, acc, m[1]);
        faces.transferFrom(alice, acc, m[2]);
        vm.stopPrank();
        uint256 paid;
        for (uint256 g = 60_000; g <= 1_600_000; g += 20_000) {
            uint256 snap = vm.snapshotState();
            vm.prank(alice);
            (bool ok,) = address(faces).call{gas: g}(abi.encodeCall(faces.transferFrom, (alice, acc, m[3])));
            if (ok) {
                (uint32 anchorId,) = seeder.setBonus(setId);
                assertEq(anchorId, m[0], "moved in without its bonus");
                ++paid;
            }
            vm.revertToState(snap);
        }
        assertGt(paid, 0, "enough gas pays it");
    }

    // ------------------------------------------------------------------
    // Fusing: a set held together for good
    // ------------------------------------------------------------------
    function test_Fuse_OnlyTheHolderOfAnAssembledSet() public {
        _mintAndReveal(120);
        (uint256 setId, uint256[4] memory m) = _firstSet(120);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetNotAssembled.selector, m[0]));
        seeder.fuse(m[0]);
        _assemble(m, m[0]);
        vm.prank(bob);
        vm.expectRevert(NeonSeeder.NotTheHolder.selector);
        seeder.fuse(m[0]);

        vm.expectEmit(address(seeder));
        emit NeonSeeder.SetFused(setId, m[0]);
        vm.prank(alice);
        seeder.fuse(m[0]);
        (uint32 anchorId, uint64 at) = seeder.fusedSet(setId);
        assertEq(anchorId, m[0]);
        assertEq(at, block.timestamp);
        assertEq(seeder.fusedCount(), 1);
        assertEq(seeder.fusedAnchorOf(m[2]), m[0]);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonSeeder.SetAlreadyFused.selector, setId));
        seeder.fuse(m[0]);
    }

    function test_Fuse_PiecesNeverLeaveAndTheSetSellsWhole() public {
        _mintAndReveal(120);
        (, uint256[4] memory m) = _firstSet(120);
        address acc = _assemble(m, m[0]);
        vm.prank(alice);
        seeder.fuse(m[0]);
        vm.prank(alice);
        vm.expectRevert(); // NeonFaces: SetIsFused, whichever way the account tries
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[1])), 0);

        vm.prank(alice);
        faces.transferFrom(alice, bob, m[0]); // the anchor still trades, with the set inside
        assertTrue(seeder.isAssembled(m[0]));
        vm.prank(bob);
        vm.expectRevert();
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, bob, m[3])), 0);
        assertEq(faces.ownerOf(m[3]), acc);
    }

    function test_Fuse_ANestedAnchorFusesThroughTheFaceAboveIt() public {
        _mintAndReveal(120);
        (, uint256[4] memory m) = _firstSet(120);
        _assemble(m, m[0]);
        uint256 top = 1;
        while (top == m[0] || top == m[1] || top == m[2] || top == m[3]) ++top;
        address topAcc = seeder.accountOf(top);
        vm.startPrank(alice);
        faces.transferFrom(alice, topAcc, m[0]); // the whole set sits inside another Face
        NeonFaceAccount(payable(topAcc)).execute(address(seeder), 0, abi.encodeCall(seeder.fuse, (m[0])), 0);
        vm.stopPrank();
        assertEq(seeder.fusedAnchorOf(m[1]), m[0]);
        // the anchor itself can still come out of the Face above
        vm.prank(alice);
        NeonFaceAccount(payable(topAcc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (topAcc, alice, m[0])), 0);
        assertEq(faces.ownerOf(m[0]), alice);
    }

    function test_Sets_OnlyTheSeederAnnouncesDeliveries() public {
        _mintAndReveal(8);
        vm.expectRevert(NeonFaces.OnlySeeder.selector);
        vm.prank(carol);
        faces.metadataChanged(1);
    }

    function test_Sets_BuyingTheAnchorBuysTheWholeSet() public {
        _mintAndReveal(120);
        (, uint256[4] memory m) = _firstSet(120);
        address acc = _assemble(m, m[0]);
        vm.prank(alice);
        faces.transferFrom(alice, bob, m[0]); // one sale
        assertTrue(seeder.isAssembled(m[0]));
        // bob now controls the three pieces inside, alice doesn't
        vm.prank(alice);
        vm.expectRevert();
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[1])), 0);
        vm.prank(bob);
        NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, bob, m[1])), 0);
        assertEq(faces.ownerOf(m[1]), bob);
    }

    // ------------------------------------------------------------------
    // Ownership cycles: a Face can never end up owning itself
    // ------------------------------------------------------------------
    function test_Cycle_FaceIntoItsOwnAccountIsRefused() public {
        _openPublic();
        _mintPublic(alice, 2);
        address acc1 = seeder.accountOf(1);
        vm.startPrank(alice);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc1, 1); // plain transfer: no receiver hook to stop it
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.safeTransferFrom(alice, acc1, 1);
        vm.stopPrank();
        assertEq(faces.ownerOf(1), alice);
    }

    function test_Cycle_TwoFacesInsideEachOtherIsRefused() public {
        _openPublic();
        _mintPublic(alice, 2);
        vm.startPrank(alice);
        faces.transferFrom(alice, seeder.accountOf(1), 2); // 2 inside 1: fine
        vm.stopPrank();
        // 1 into 2's account would lock both forever (2's owner is 1's account)
        address acc2 = seeder.accountOf(2);
        vm.prank(alice);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc2, 1);
    }

    function test_Cycle_NestingDepthIsCapped() public {
        _openPublic(10);
        _mintPublic(alice, 6);
        // chain: 2 inside 1, 3 inside 2, 4 inside 3, 5 inside 4 -> 4 levels of Face accounts above 5
        vm.startPrank(alice);
        for (uint256 id = 2; id <= 5; ++id) {
            faces.transferFrom(alice, seeder.accountOf(id - 1), id);
        }
        // 6 into 5's account would be a 5th level
        address acc5 = seeder.accountOf(5);
        vm.expectRevert(NeonFaces.OwnershipCycle.selector);
        faces.transferFrom(alice, acc5, 6);
        vm.stopPrank();
    }

    function test_Cycle_MovingIntoAFaceRefreshesItsMetadata() public {
        _openPublic();
        _mintPublic(alice, 2);
        address acc1 = seeder.accountOf(1);
        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(1); // the Face that now holds it
        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(2); // the moved Face: its set status changes too
        vm.prank(alice);
        faces.transferFrom(alice, acc1, 2);

        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(1);
        vm.expectEmit(address(faces));
        emit IERC4906.MetadataUpdate(2);
        vm.prank(alice);
        NeonFaceAccount(payable(acc1)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc1, bob, 2)), 0);
        assertEq(faces.ownerOf(2), bob);
    }

    function test_Cycle_OrdinaryTransfersUnaffected() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(alice);
        faces.transferFrom(alice, address(this), 1); // a contract that is not a Face account
        faces.transferFrom(address(this), bob, 1);
        assertEq(faces.ownerOf(1), bob);
    }

    // ------------------------------------------------------------------
    // A set sold as one Face: the lock and the agents follow the outer Face
    // ------------------------------------------------------------------
    function _nestedSetup() internal returns (uint256[4] memory m, NeonFaceAccount anchorAcc, NeonFaceAccount pieceAcc) {
        _mintAndReveal(120);
        (, m) = _firstSet(120);
        anchorAcc = NeonFaceAccount(payable(_assemble(m, m[0])));
        pieceAcc = NeonFaceAccount(payable(seeder.accountOf(m[1])));
    }

    function _pieceCall(NeonFaceAccount anchorAcc, NeonFaceAccount pieceAcc, bytes memory data) internal {
        vm.prank(alice);
        anchorAcc.execute(address(pieceAcc), 0, data, 0);
    }

    function test_Nested_PieceAgentDiesWhenTheAnchorIsSold() public {
        (uint256[4] memory m, NeonFaceAccount anchorAcc, NeonFaceAccount pieceAcc) = _nestedSetup();
        address thief = makeAddr("thief");
        NeonFaceAccount.Permission[] memory p = new NeonFaceAccount.Permission[](1);
        p[0] = NeonFaceAccount.Permission(address(tsla), tsla.transfer.selector);
        // the seller delegates an agent on a piece, through the anchor's account
        _pieceCall(anchorAcc, pieceAcc, abi.encodeCall(NeonFaceAccount.setAgent, (thief, uint64(block.timestamp + 30 days), p, 0)));
        assertEq(pieceAcc.holder(), alice, "the holder of a nested piece is the anchor's holder");
        (, address grantor,, bool active,) = pieceAcc.agentConfig();
        assertEq(grantor, alice);
        assertTrue(active);

        vm.prank(alice);
        faces.transferFrom(alice, bob, m[0]); // the set is sold
        assertEq(pieceAcc.holder(), bob);
        (,,, active,) = pieceAcc.agentConfig();
        assertFalse(active, "the agent died with the sale of the outer Face");
        uint256 bal = tsla.balanceOf(address(pieceAcc));
        vm.prank(thief);
        vm.expectRevert(NeonFaceAccount.AgentNotActive.selector);
        pieceAcc.executeAsAgent(address(tsla), 0, abi.encodeCall(tsla.transfer, (thief, bal)));
    }

    function test_Nested_AnchorLockFreezesThePieces() public {
        (uint256[4] memory m, NeonFaceAccount anchorAcc, NeonFaceAccount pieceAcc) = _nestedSetup();
        address thief = makeAddr("thief");
        NeonFaceAccount.Permission[] memory p = new NeonFaceAccount.Permission[](1);
        p[0] = NeonFaceAccount.Permission(address(tsla), tsla.transfer.selector);
        _pieceCall(anchorAcc, pieceAcc, abi.encodeCall(NeonFaceAccount.setAgent, (thief, uint64(block.timestamp + 30 days), p, 0)));
        // an operator approved on a piece before the lock
        vm.prank(alice);
        anchorAcc.execute(address(faces), 0, abi.encodeCall(faces.setApprovalForAll, (thief, true)), 0);

        uint64 until = uint64(block.timestamp + 7 days);
        vm.prank(alice);
        anchorAcc.lock(until); // listed as locked
        assertEq(pieceAcc.effectiveLockedUntil(), until, "a piece inside a locked Face is locked");
        assertTrue(pieceAcc.isLocked());
        assertEq(pieceAcc.lockedUntil(), 0, "its own lock is untouched");

        uint256 bal = tsla.balanceOf(address(pieceAcc));
        vm.startPrank(thief);
        vm.expectRevert(abi.encodeWithSelector(NeonFaceAccount.AccountIsLocked.selector, until));
        pieceAcc.executeAsAgent(address(tsla), 0, abi.encodeCall(tsla.transfer, (thief, bal)));
        vm.expectRevert(NeonFaces.FaceAccountLocked.selector);
        faces.transferFrom(address(anchorAcc), thief, m[1]); // can't pull a piece out of the locked Face
        vm.stopPrank();
        assertEq(pieceAcc.isValidSignature(bytes32(0), ""), bytes4(0xffffffff));

        vm.warp(until);
        vm.prank(thief);
        faces.transferFrom(address(anchorAcc), thief, m[1]); // after the lock, approvals work again
        assertEq(faces.ownerOf(m[1]), thief);
    }

    function test_Nested_DeepStacksHaveNoHolder() public {
        _mintAndReveal(12);
        // each move only checks the levels above the receiver: built bottom-up, 1 ends up 9 levels down
        vm.startPrank(alice);
        for (uint256 id = 1; id <= 9; ++id) faces.transferFrom(alice, seeder.accountOf(id + 1), id);
        vm.stopPrank();
        NeonFaceAccount deep = NeonFaceAccount(payable(seeder.accountOf(1)));
        assertEq(deep.holder(), address(0));
        assertTrue(deep.isLocked(), "too deep counts as locked until taken apart from the top");
        assertEq(NeonFaceAccount(payable(seeder.accountOf(4))).holder(), alice);
    }
}
