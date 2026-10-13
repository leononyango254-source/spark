// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CampaignEscrow {
    struct Campaign {
        address creator;
        uint256 budget;
        uint256 balance;
        uint256 deadline;
        bool closed;
    }

    address public owner;
    address public operator;
    IERC20 public immutable usdc;
    uint256 public maxPayoutPerReward;
    uint256 public globalPayoutAllowance;
    bool private _paused;

    uint256 public nextCampaignId = 1;

    uint256 private _guardCounter = 1;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => bool) public processedReward;
    mapping(uint256 => mapping(uint256 => bool)) public usedNonce;

    event CampaignCreated(uint256 indexed id, address indexed creator, uint256 budget, uint256 deadline);
    event CampaignFunded(uint256 indexed campaignId, address indexed funder, uint256 amount);
    event RewardPaid(uint256 indexed campaignId, uint256 indexed rewardId, address indexed to, uint256 amount, uint256 nonce);
    event CampaignClosed(uint256 indexed campaignId, address indexed closer, uint256 refunded);
    event CampaignPaused();
    event CampaignUnpaused();
    event OperatorSet(address indexed newOperator);
    event GlobalAllowanceUpdated(uint256 newAllowance);
    event MaxPayoutUpdated(uint256 newMax);

    error NotOwner();
    error NotOperator();
    error NotAuthorized();
    error Paused();
    error CampaignIsClosed();
    error CampaignNotFound();
    error PayoutTooLarge();
    error InsufficientBalance();
    error AllowanceExceeded();
    error RewardAlreadyPaid();
    error NonceAlreadyUsed();
    error Expired();
    error InvalidRecipient();
    error InvalidAmount();
    error TokenTransferFailed();
    error Reentrant();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (_paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        _guardCounter += 1;
        uint256 localCounter = _guardCounter;
        _;
        require(localCounter == _guardCounter, "REENTRANCY");
    }

    constructor(address _usdc, uint256 _maxPayoutPerReward, uint256 _globalPayoutAllowance) {
        owner = msg.sender;
        operator = msg.sender;
        usdc = IERC20(_usdc);
        maxPayoutPerReward = _maxPayoutPerReward;
        globalPayoutAllowance = _globalPayoutAllowance;
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorSet(newOperator);
    }

    function setGlobalPayoutAllowance(uint256 allowance) external onlyOwner {
        globalPayoutAllowance = allowance;
        emit GlobalAllowanceUpdated(allowance);
    }

    function setMaxPayoutPerReward(uint256 max) external onlyOwner {
        maxPayoutPerReward = max;
        emit MaxPayoutUpdated(max);
    }

    function pause() external onlyOwner {
        _paused = true;
        emit CampaignPaused();
    }

    function unpause() external onlyOwner {
        _paused = false;
        emit CampaignUnpaused();
    }

    function isPaused() external view returns (bool) {
        return _paused;
    }

    function createCampaign(address _creator, uint256 budget, uint256 deadline)
        external
        onlyOwner
        whenNotPaused
        returns (uint256 id)
    {
        if (_creator == address(0)) revert InvalidRecipient();
        if (budget == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert Expired();
        id = nextCampaignId++;
        campaigns[id] = Campaign({ creator: _creator, budget: budget, balance: 0, deadline: deadline, closed: false });
        emit CampaignCreated(id, _creator, budget, deadline);
    }

    function fundCampaign(uint256 campaignId, uint256 amount) external whenNotPaused nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (amount == 0) revert InvalidAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
        c.balance += amount;
        emit CampaignFunded(campaignId, msg.sender, amount);
    }

    function payReward(
        uint256 campaignId,
        uint256 rewardId,
        uint256 nonce,
        address recipient,
        uint256 amount,
        uint256 deadline
    ) external onlyOperator whenNotPaused nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (block.timestamp > deadline) revert Expired();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (processedReward[rewardId]) revert RewardAlreadyPaid();
        if (usedNonce[campaignId][nonce]) revert NonceAlreadyUsed();
        if (amount > c.balance) revert InsufficientBalance();
        if (amount > maxPayoutPerReward) revert PayoutTooLarge();
        if (amount > globalPayoutAllowance) revert AllowanceExceeded();

        processedReward[rewardId] = true;
        usedNonce[campaignId][nonce] = true;
        c.balance -= amount;
        globalPayoutAllowance -= amount;

        if (!usdc.transfer(recipient, amount)) revert TokenTransferFailed();
        emit RewardPaid(campaignId, rewardId, recipient, amount, nonce);
    }

    function closeCampaign(uint256 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert CampaignNotFound();
        if (c.closed) revert CampaignIsClosed();
        if (msg.sender != owner && msg.sender != c.creator) revert NotAuthorized();
        uint256 refund = c.balance;
        c.closed = true;
        c.balance = 0;
        if (refund > 0 && !usdc.transfer(c.creator, refund)) revert TokenTransferFailed();
        emit CampaignClosed(campaignId, msg.sender, refund);
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    function isRewardProcessed(uint256 rewardId) external view returns (bool) {
        return processedReward[rewardId];
    }

    function isNonceUsed(uint256 campaignId, uint256 nonce) external view returns (bool) {
        return usedNonce[campaignId][nonce];
    }
}
