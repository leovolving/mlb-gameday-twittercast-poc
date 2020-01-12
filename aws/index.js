const moment = require("moment-timezone");
const request = require("request-promise-native");

let gamePk = null;
let timestamp;
const postedTweets = [];

exports.handler = async event => await twitterFunction();

async function twitterFunction() {
  if (!gamePk || !timestamp) {
    return getTodaysGame().then(_ => {
      if (gamePk) {
        console.log("gamePk", gamePk);
        return getData();
      }
    });
  } else return getDiff();
}

const testTeamId = process.env.TEAM_ID || 671; // Leones del Escogido
const sport = process.env.SPORT || 17; // winter leagues. MLB = 1

async function getTodaysGame() {
  const todaysGameUrl = `http://statsapi.mlb.com/api/v1/schedule/games/?sportId=${sport}&date=${moment().tz('America/Los_Angeles').format(
    "MM/DD/YYYY"
  )}&teamId=${testTeamId}`;
  console.log('todaysGameUrl', todaysGameUrl)
  return request(todaysGameUrl).then(response => {
    const data = JSON.parse(response);
    gamePk = data.dates.length ? data.dates[0].games[0].gamePk : null;
  });
}

async function getData() {
  if (gamePk) {
    const liveFeedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
    return request(liveFeedUrl).then(convertInitialDataToTweets);
  }
}

async function convertInitialDataToTweets(response) {
  const data = JSON.parse(response);
  timestamp = data.metaData.timeStamp;
  console.log("timestamp", timestamp);
  const ap = data.liveData.plays.allPlays
  for (let i = 0; i < ap.length; i++) {
    const play = ap[i];
    const description = play.result.description;
    if (description) await postTweet(description);
  }
}

async function postTweet(status) {
  if (!postedTweets.includes(status)) {
    console.log('=====================status=====================', status)
    const twitterUrl = `https://api.twitter.com/1.1/statuses/update.json?status=${encodeURI(status)}`;
    return await request({
      url: twitterUrl,
      method: 'POST',
      json: true,
      oauth: {
        consumer_key: process.env.TWITTER_CONSUMER_KEY || '',
        consumer_secret: process.env.TWITTER_CONSUMER_SECRET || '',
        token: process.env.TWITTER_ACCESS_TOKEN_KEY || '',
        token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET || ''
      }
    }).then(res => {
      console.log("\n res:" + res + "\n");

      console.log('static: ' + status + "\n");
      postedTweets.push(status);
    }).catch(e => {
      console.log('error with tweet', e.message)
    })

  }
}

async function getDiff() {
  const diffUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live/diffPatch?language=en&startTimecode=${timestamp}`;
  console.log("diffUrl", diffUrl);
  return request(diffUrl).then(async response => {
    const data = JSON.parse(response);
    console.log(response + "\n");
    console.log("data", data);
    // sometimes the data comes back as an array, other times, it duplicates the initial data
    // Current theory: it happens when the inning changes
    if (!data.map) return convertInitialDataToTweets(response);
    const diffs = data.map(diffs => diffs.diff);
    console.log("diffs", diffs);
    if (diffs.length) {
      console.log("first timestamp", data[0].diff[0].value);
      timestamp = data[data.length - 1].diff[0].value;
      console.log("last timestamp ", timestamp);
      // diffs sometimes doesn't duplicate. Will have to loop through diffs
      const result = diffs[0].filter(doesEventHaveDescription);
      const lineScoreUrl = `https://statsapi.mlb.com/api/v1/game/${gamePk}/linescore`;
      const lineScore = await request(lineScoreUrl);
      const inningStatsText = getInningStatsText(lineScore);
      console.log("inningStatsText", inningStatsText);
      console.log("result", result);
      result.forEach(event => {
        const eventText = event.value + inningStatsText;
        postTweet(eventText);
      });
    }
  });
}

function getInningStatsText(lineScore) {
  const lsp = JSON.parse(lineScore);
  const { currentInning, currentInningOrdinal, inningState, outs } = lsp;
  if (!currentInning) return "";
  const outsString = outs === 1 ? "out" : "outs";
  return ` ${inningState} of the ${currentInningOrdinal}. ${outs ||
    0} ${outsString}`;
}

function doesEventHaveDescription(event) {
  console.log("event: ", event);
  return event.value && event.path.endsWith("/result/description");
}

// twitterFunction();
