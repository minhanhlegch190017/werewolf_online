const express = require('express');
const Room = require('../../models/Room');
const Vote = require('../../models/Vote');
const router = express.Router();
const GameEvent = require('../../event/game.event');
const auth = require('../../middleware/auth');

/**
 * Start game
 */
router.post('/:roomId/start', auth, async (req, res) => {
  //Assign role
  const roomInfo = await Room.findById(req.params.roomId)
    .select(['+roles'])
    .populate('players', ['name', 'avatar']);

  if (!roomInfo || roomInfo.status === 'CLOSED') {
    return res.status(400).json({ msg: 'Wrong' });
  }

  const playerStatus = createInitialStatus(roomInfo);
  roomInfo.roles = createInitialRoles(roomInfo);
  roomInfo.playerStatus = playerStatus;
  roomInfo.status = 'PLAYING';
  roomInfo.turnTimeStamp = new Date();
  await roomInfo.save();

  // this event is global?
  GameEvent.eventEmitter.emit('ROOM_TURN_DAY_START', roomInfo);
  return res.json(roomInfo._id);
});

//POST players roles do vote
//Create a new schema: turn, phase, trigger, targeted
router.post('/:roomId/vote', auth, async (req, res) => {
  const roomInfo = await Room.findById(req.params.roomId).select(['+roles']);

  if (!roomInfo) {
    return res.status(404).send('room khong ton tai`');
  }

  if (roomInfo.playerStatus[req.user.id] === 'DEAD') {
    return res.status(400).send('may chet roi`');
  }

  if (roomInfo.roles[req.user.id] === 'villager') {
    if (roomInfo.phase === 'NIGHT') {
      return res.status(400).json('bo lao vcl');
    }
  }

  return handleVote(roomInfo, req, res);
});

/**
 * GET room information.
 */
router.get('/:roomId/info', [auth], async (req, res) => {
  const roomInfo = await Room.findById(req.params.roomId)
    .select(['+roles'])
    .populate('players', ['name', 'avatar']);

  if (!roomInfo || roomInfo.status === 'CLOSED') {
    return res.status(400).json({ msg: 'Wrong' });
  }
  const returnObject = roomInfo.toObject();
  returnObject.roles = returnObject.roles[req.user.id];
  return res.json(returnObject);
});

//function rollDice
function rollDice(remainRoles) {
  if (remainRoles.length === 0) {
    return null;
  }

  var randomIndex = Math.floor(Math.random() * remainRoles.length);
  var randomRole = remainRoles[randomIndex];
  remainRoles.splice(randomIndex, 1);

  return randomRole;
}

function generateRolesOnNumberOfPlayer(amount) {
  const initialArr = ['WOLF', 'VILLAGER'];
  if (amount <= 2) {
    return initialArr;
  }
  for (let i = 0; i < amount - 2; i++) {
    initialArr.push('VILLAGER');
  }
  return initialArr;
}

function createInitialRoles(roomInfo) {
  const remainRoles = generateRolesOnNumberOfPlayer(roomInfo.players.length);
  const roles = {};
  /**
   * P1: id=1
   * P2: id=2
   * P3: id=3
   */
  roomInfo.players.forEach((player) => {
    /**
     * x = id
     * P[x] <-- rollDice (random role)
     * roles[x] = rollDice
     * eg:
     *
     * {
     *    1: 'villager'
     *    2: 'woft',
     *    3: 'villager'
     * }
     *
     * eg: when access
     *
     * roles[user.id] === "villager"
     */
    const roleToAssign = rollDice(remainRoles);
    if (!roleToAssign) {
      return null;
    }
    roles[player._id.toString()] = roleToAssign;
  });
  return roles;
}

function createInitialStatus(roomInfo) {
  const playerStatus = {};
  roomInfo.players.forEach((player) => {
    playerStatus[player._id.toString()] = 'ALIVE';
  });
  return playerStatus;
}

async function handleVote(roomInfo, req, res) {
  const infoVote = {
    room: roomInfo.id,
    phase: roomInfo.phase,
    turn: roomInfo.turn,
    trigger: req.user.id,
  };
  const payloadVote = req.body;

  const alreadyVoted = await Vote.findOne(infoVote);

  if (alreadyVoted) {
    return res.status(400).send('may vote roi`');
  }

  if (payloadVote.type === 'SKIP') {
    // create vote and skip.
    const newVote = Object.assign({}, infoVote, {
      type: payloadVote.type,
    });

    const newVoteModel = new Vote(newVote);
    await newVoteModel.save();
    return res.json(newVoteModel);
  }

  if (
    payloadVote.targeted === req.user.id ||
    roomInfo.playerStatus[payloadVote.targeted] === 'DEAD'
  ) {
    return res.status(400).send('target vote sai roi`');
  }

  // action now is KILL
  const newVote = Object.assign({}, infoVote, {
    type: payloadVote.type,
    targeted: payloadVote.targeted,
  });
  const newVoteModel = new Vote(newVote);
  await newVoteModel.save();
  return res.json(newVoteModel);
}

module.exports = router;
