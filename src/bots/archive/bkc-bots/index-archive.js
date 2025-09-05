const llog = require('learninglab-log');
const friend = require('./friend');
const foe = require('./foe');

const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds*1000));



module.exports = async ({ client, message, say, event }) => {
    llog.cyan("got a message the day of the ts280 demo")
    const poetResult = await poet({ client, message, say, event });
    await wait(3);
    const poetryCriticResult = await poetryCritic({
        client: client,
        message: message,
        poemToCritique: poetResult
    })
}

