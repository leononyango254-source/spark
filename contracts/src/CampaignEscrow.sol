// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Phase 0 spike skeleton. Purpose: prove the escrow bytecode deploys
/// and executes on Arc. NOT production. Deliberately has no withdraw/sweep/rescue.
contract CampaignEscrow {
    address public owner;
    address public operator;
    address public immutable usdc;
    uint256 public immutable maxPayoutMicroUsdc;
    uint256 public globalPayoutAllowance;

    struct Campaign {
        address creator;
        uint256 budget;
        uint256 balance;
        uint256 deadline;
        bool closed;
    }

    mapping(uint256 => Campaign) public campaigns;
    uint256 public nextCampaignId = 1;

    event CampaignCreated(uint256 indexed id, address indexed creator, uint256 budget, uint256 deadline);
    event CampaignFunded(uint256 indexed id, uint256 amount);
    event RewardPaid(uint256 indexed id, address indexed to, uint256 amount, uint256 indexed rewardId);
    event CampaignClosed(uint256 indexed id, uint256 refunded);

    error NotOwner();
    error NotOperator();
    error PayoutTooLarge();
    error InsufficientBalance();
    error AllowanceExceeded();
    error CampaignIsClosed();
    error NotAuthorized();
    error TokenTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address _usdc, uint256 _maxPayoutMicroUsdc, uint256 _globalPayoutAllowance) {
        owner = msg.sender;
        operator = msg.sender;
        usdc = _usdc;
        maxPayoutMicroUsdc = _maxPayoutMicroUsdc;
        globalPayoutAllowance = _globalPayoutAllowance;
    }

    function setOperator(address o) external onlyOwner {
        operator = o;
    }

    function setGlobalPayoutAllowance(uint256 a) external onlyOwner {
        globalPayoutAllowance = a;
    }

    function createCampaign(address creator, uint256 budget, uint256 deadline)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = nextCampaignId++;
        campaigns[id] = Campaign(creator, budget, 0, deadline, false);
        emit CampaignCreated(id, creator, budget, deadline);
    }

    function fundCampaign(uint256 id, uint256 amount) external {
        Campaign storage c = campaigns[id];
        if (c.closed) revert CampaignIsClosed();
        if (!IERC20(usdc).transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
        c.balance += amount;
        emit CampaignFunded(id, amount);
    }

    function payReward(uint256 id, address to, uint256 amount, uint256 rewardId) external onlyOperator {
        Campaign storage c = campaigns[id];
        if (c.closed) revert CampaignIsClosed();
        if (amount > maxPayoutMicroUsdc) revert PayoutTooLarge();
        if (amount > c.balance) revert InsufficientBalance();
        if (amount > globalPayoutAllowance) revert AllowanceExceeded();
        c.balance -= amount;
        globalPayoutAllowance -= amount;
        if (!IERC20(usdc).transfer(to, amount)) revert TokenTransferFailed();
        emit RewardPaid(id, to, amount, rewardId);
    }

    function closeCampaign(uint256 id) external {
        Campaign storage c = campaigns[id];
        if (c.closed) revert CampaignIsClosed();
        if (msg.sender != owner && msg.sender != c.creator) revert NotAuthorized();
        uint256 refund = c.balance;
        c.balance = 0;
        c.closed = true;
        if (refund > 0 && !IERC20(usdc).transfer(c.creator, refund)) revert TokenTransferFailed();
        emit CampaignClosed(id, refund);
    }
}
