// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {NeonFaces} from "./NeonFaces.sol";
import {NeonSeeder} from "./NeonSeeder.sol";

/// @title NeonSetVotes — the say of the completed sets
/// @notice The treasury asks a question (for instance which tickers go into the next baskets it funds) and every
/// assembled set has one vote: the set votes, not the wallet. Its holder casts it, and can change it until the poll
/// ends, so a set sold during a poll carries its vote to the new holder. A set counts once however it is assembled,
/// taken apart or reassembled. Advisory: nothing here moves funds or changes a contract; the treasury reads the
/// result before deciding, and says so when it doesn't follow it. No owner beyond the address that asks questions.
contract NeonSetVotes {
    uint256 public constant MAX_CHOICES = 8;
    uint256 public constant MAX_QUESTION = 280;
    uint256 public constant MAX_CHOICE = 64;

    struct Poll {
        string question;
        string[] choices;
        uint64 start;
        uint64 end;
        uint32 votes; // sets that voted
    }

    NeonFaces public immutable faces;
    NeonSeeder public immutable seeder;
    /// @notice The only address that can ask a question (the treasury Safe).
    address public immutable pollster;

    Poll[] internal _polls;
    /// @dev choice + 1 of each set, per poll (0 = not voted)
    mapping(uint256 pollId => mapping(uint256 setId => uint8)) internal _voteOf;
    mapping(uint256 pollId => mapping(uint256 choice => uint256)) public tally;

    event PollCreated(uint256 indexed pollId, string question, string[] choices, uint64 start, uint64 end);
    event Voted(uint256 indexed pollId, uint256 indexed setId, uint256 anchorId, address voter, uint256 choice);

    error OnlyPollster();
    error BadPoll();
    error PollClosed(uint256 pollId);
    error NotTheHolder();
    error SetNotAssembled(uint256 anchorId);
    error BadChoice();

    constructor(NeonFaces faces_, NeonSeeder seeder_, address pollster_) {
        if (address(faces_) == address(0) || address(seeder_) == address(0) || pollster_ == address(0)) revert BadPoll();
        faces = faces_;
        seeder = seeder_;
        pollster = pollster_;
    }

    /// @notice Ask the sets a question, open from `start` to `end` (unix seconds).
    function createPoll(string calldata question, string[] calldata choices, uint64 start, uint64 end)
        external
        returns (uint256 pollId)
    {
        if (msg.sender != pollster) revert OnlyPollster();
        if (
            bytes(question).length == 0 || bytes(question).length > MAX_QUESTION || choices.length < 2
                || choices.length > MAX_CHOICES || end <= start || end <= block.timestamp
        ) revert BadPoll();
        for (uint256 i; i < choices.length; ++i) {
            if (bytes(choices[i]).length == 0 || bytes(choices[i]).length > MAX_CHOICE) revert BadPoll();
        }
        pollId = _polls.length;
        Poll storage p = _polls.push();
        p.question = question;
        for (uint256 i; i < choices.length; ++i) p.choices.push(choices[i]);
        p.start = start;
        p.end = end;
        emit PollCreated(pollId, question, choices, start, end);
    }

    /// @notice Cast (or change) the vote of the set that `anchorId` holds assembled. Only the anchor's owner: a
    /// wallet, or the account of a Face it sits in, through `execute`.
    function vote(uint256 pollId, uint256 anchorId, uint256 choice) external {
        if (pollId >= _polls.length) revert BadPoll();
        Poll storage p = _polls[pollId];
        if (block.timestamp < p.start || block.timestamp >= p.end) revert PollClosed(pollId);
        if (choice >= p.choices.length) revert BadChoice();
        if (faces.ownerOf(anchorId) != msg.sender) revert NotTheHolder();
        if (!seeder.isAssembled(anchorId)) revert SetNotAssembled(anchorId);
        (uint256 setId,,) = seeder.setOf(anchorId);
        uint8 previous = _voteOf[pollId][setId];
        if (previous == 0) ++p.votes;
        else --tally[pollId][previous - 1];
        _voteOf[pollId][setId] = uint8(choice + 1);
        ++tally[pollId][choice];
        emit Voted(pollId, setId, anchorId, msg.sender, choice);
    }

    function pollCount() external view returns (uint256) {
        return _polls.length;
    }

    /// @notice A poll with its running results, one count per choice.
    function poll(uint256 pollId)
        external
        view
        returns (string memory question, string[] memory choices, uint64 start, uint64 end, uint256 votes, uint256[] memory counts)
    {
        Poll storage p = _polls[pollId];
        counts = new uint256[](p.choices.length);
        for (uint256 i; i < counts.length; ++i) counts[i] = tally[pollId][i];
        return (p.question, p.choices, p.start, p.end, p.votes, counts);
    }

    /// @notice The choice a set voted for (type(uint256).max if it hasn't).
    function voteOf(uint256 pollId, uint256 setId) external view returns (uint256) {
        uint8 v = _voteOf[pollId][setId];
        return v == 0 ? type(uint256).max : v - 1;
    }
}
