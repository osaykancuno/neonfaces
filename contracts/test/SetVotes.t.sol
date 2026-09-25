// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {NeonSetVotes} from "../src/NeonSetVotes.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";

/// @notice The say of the completed sets: one vote per assembled set, cast by its holder, advisory.
contract SetVotesTest is Base {
    NeonSetVotes votes;
    uint256 pollId;

    function setUp() public override {
        super.setUp();
        votes = new NeonSetVotes(faces, seeder, admin);
        _commitProvenance();
        _allowTestAsSeaDrop();
        faces.mintSeaDrop(alice, 100);
        faces.mintSeaDrop(alice, 20);
        _reveal();
        string[] memory choices = new string[](3);
        (choices[0], choices[1], choices[2]) = ("AAPL", "QQQ", "GLD");
        vm.prank(admin);
        pollId = votes.createPoll("Which ticker goes into the next basket?", choices, uint64(block.timestamp), uint64(block.timestamp + 7 days));
    }

    function _set(uint256 skip) internal view returns (uint256 setId, uint256[4] memory m) {
        for (uint256 id = 1; id <= 120; ++id) {
            (setId,, m) = seeder.setOf(id);
            if (setId != 0 && m[0] == id) {
                if (skip == 0) return (setId, m);
                --skip;
            }
        }
        revert("no set");
    }

    function _assemble(uint256[4] memory m) internal {
        address acc = seeder.accountOf(m[0]);
        vm.startPrank(faces.ownerOf(m[0]));
        for (uint256 q = 1; q < 4; ++q) faces.transferFrom(faces.ownerOf(m[q]), acc, m[q]);
        vm.stopPrank();
    }

    function test_OnlyThePollsterAsks() public {
        string[] memory choices = new string[](2);
        (choices[0], choices[1]) = ("yes", "no");
        vm.prank(bob);
        vm.expectRevert(NeonSetVotes.OnlyPollster.selector);
        votes.createPoll("?", choices, 0, uint64(block.timestamp + 1 days));
        string[] memory one = new string[](1);
        one[0] = "only";
        vm.prank(admin);
        vm.expectRevert(NeonSetVotes.BadPoll.selector);
        votes.createPoll("?", one, 0, uint64(block.timestamp + 1 days));
    }

    function test_OneVotePerAssembledSet_TheSetKeepsItsVote() public {
        (uint256 setId, uint256[4] memory m) = _set(0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonSetVotes.SetNotAssembled.selector, m[0]));
        votes.vote(pollId, m[0], 1);

        _assemble(m);
        vm.prank(bob);
        vm.expectRevert(NeonSetVotes.NotTheHolder.selector);
        votes.vote(pollId, m[0], 1);
        vm.prank(alice);
        votes.vote(pollId, m[0], 1);
        assertEq(votes.tally(pollId, 1), 1);
        assertEq(votes.voteOf(pollId, setId), 1);

        // changing the vote moves it, never adds one
        vm.prank(alice);
        votes.vote(pollId, m[0], 2);
        (,,,, uint256 n, uint256[] memory counts) = votes.poll(pollId);
        assertEq(n, 1);
        assertEq(counts[1], 0);
        assertEq(counts[2], 1);

        // sold during the poll: the new holder decides the set's vote
        vm.prank(alice);
        faces.transferFrom(alice, bob, m[0]);
        vm.prank(bob);
        votes.vote(pollId, m[0], 0);
        (,,,, n, counts) = votes.poll(pollId);
        assertEq(n, 1);
        assertEq(counts[0], 1);
        assertEq(counts[2], 0);
    }

    function test_ReassemblingAroundAnotherPieceDoesNotVoteTwice() public {
        (, uint256[4] memory m) = _set(0);
        _assemble(m);
        vm.prank(alice);
        votes.vote(pollId, m[0], 1);
        address acc = seeder.accountOf(m[0]);
        vm.startPrank(alice);
        for (uint256 q = 1; q < 4; ++q) {
            NeonFaceAccount(payable(acc)).execute(address(faces), 0, abi.encodeCall(faces.transferFrom, (acc, alice, m[q])), 0);
        }
        address acc3 = seeder.accountOf(m[3]);
        for (uint256 q; q < 3; ++q) faces.transferFrom(alice, acc3, m[q]);
        votes.vote(pollId, m[3], 1);
        vm.stopPrank();
        (,,,, uint256 n, uint256[] memory counts) = votes.poll(pollId);
        assertEq(n, 1, "one set, one vote");
        assertEq(counts[1], 1);
    }

    function test_ClosedAfterTheEnd() public {
        (, uint256[4] memory m) = _set(0);
        _assemble(m);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NeonSetVotes.PollClosed.selector, pollId));
        votes.vote(pollId, m[0], 0);
    }
}
