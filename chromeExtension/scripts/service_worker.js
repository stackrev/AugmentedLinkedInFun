/**
 * @license
 * Attribution-NonCommercial-NoDerivatives 4.0 Internation
 *
 * https://creativecommons.org/licenses/by-nc-nd/4.0/
 *
 * @author adamd
 * =============================================================================
 */
import * as use from '@tensorflow-models/universal-sentence-encoder';
import * as tf from '@tensorflow/tfjs';
import * as tfc from '@tensorflow/tfjs-converter'

const DEFAULT_MODEL_PATH = './model.json'

/**
 * Async loads a USE and our Custom models on construction.  
 * 
 * Classifies a linkedin profile to the content.js to manipulate the DOM.
 */
class ProfileClassifier {
    /**
     * Constructor.
     * @param {*} savedClassifier The classifier to load from. Can be url string or the json file.
     */
    constructor(savedClassifier = null) {
        this.savedClassifier = savedClassifier;
    }

    /**
     * Loads USE and custom Models, warms the models up.
     */
    async loadModel() {
        console.log('Loading models...');
        if (!this.savedClassifier) {
            console.error('No model.json to load from!');
            throw new Error("No model.json to load from!")
        }
        try {
            // Chrome will have a different path setup for extensions.
            console.log(`Loading USE model...`)
            this.useModel = await use.load();

            console.log(`Loading custom model...`)
            this.model = await tfc.loadGraphModel(this.savedClassifier);

            // Warms up the models by causing intermediate tensor values to be built.
            const startTime = performance.now();
            const embeddings = await this.useModel.embed(["Test descriptions"])
            const result = await this.model.predict(embeddings);

            console.log(`Model loaded with ${result}.`);

            const totalTime = Math.floor(performance.now() - startTime);
            console.log(`Models initialized in ${totalTime} ms...`);

        } catch (e) {
            console.error('Unable to load models', e);
        }
    }

    /**
     * Triggers our models to make a prediction.
     * @param {descriptions} string Profile title and descriptions.
     * @param {sendResponse} function messaging callback to reply to the content script.
     */
    async classifyProfile(descriptions, sendResponse) {
        if (!descriptions) {
            console.error('No descriptions.  No prediction.');
            return;
        }
        if (!this.model || !this.useModel) {
            console.log('Waiting for models to load...');
            setTimeout(
                () => { this.classifyProfile(descriptions, sendResponse) }, 2000);
            return;
        }
        console.log(`Predicting for ${descriptions}`);
        const startTime = performance.now();

        const embeddings = await this.useModel.embed([descriptions]);
        console.log(`embeddings: ${embeddings}`);
        const t = await this.model.predict(embeddings);
        const predictions = t.dataSync();
        console.log(`predictions: ${predictions}`);

        const totalTime = performance.now() - startTime;
        console.log(`Done in ${totalTime.toFixed(1)} ms `);

        const LABELS = ["bigbird", "count", "grover", "grouch", "erniebert"];
        const idx = predictions.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0);

        sendResponse({ 'proba': Math.floor(predictions[idx] * 100), 'label': (LABELS[idx] ?? "N/A") });
    }
}

async function getProfile() {
    // Activities are loaded by a dynamic script and might not be available
    // when the script is loaded. We try to assert it, but cannot do anything.
    const el = document.querySelector(".pvs-list");
    if (el) {
        console.log("Has activity!")
    }
    else {
        // Delay the tab close.
        await new Promise(r => setTimeout(r, 400));
    }

    return document.body.innerHTML;
}

/**
 * Async scrapes a LinkedIn profile in another tab.  
 * 
 * Returns DOM to the content.js to do alterations to the feed.
 */
class ProfileScrapper {
    constructor() {
    }

    /**
     * Triggers our models to make a prediction.
     * @param {descriptions} string Profile title and descriptions.
     * @param {sendResponse} function messaging callback to reply to the content script.
     */
    async scrapeProfile(link, sendResponse) {
        chrome.tabs
            .create({ url: link, active: false })
            .then(tab => {
                let tabID = tab.id
                chrome.scripting.executeScript({
                    func: getProfile,
                    target: {
                        tabId: tabID
                    },
                    injectImmediately: false
                }).then(injectionResults => {
                    // Should have 1 parent frame.
                    let profile = injectionResults[0]?.result;
                    console.log(`injectionResults: ${profile}`)
                    return sendResponse({ profile: profile });
                })
                    .then(() => chrome.tabs.remove(tabID))
                    .catch((error) => {
                        console.error(error.message);
                        sendResponse("BAD");
                    })
            })
    }
}

// Global variables.
const PROFILE_CLASSIFIER = new ProfileClassifier("https://raw.githubusercontent.com/adamd1985/AugmentedLinkedInFun/master/notebooks/models/tfjs/model.json");
const PROFILE_SCRAPPER = new ProfileScrapper();
PROFILE_CLASSIFIER.loadModel();

/**
 * Extension load.
 * 
 */
chrome.runtime.onInstalled.addListener(async function () {
    console.log("CoPilot loaded, models loading and initializing.");
});

/**
 * Keyboard commnad call.
 */
chrome.commands.onCommand.addListener((command) => {
    console.log(`Command: ${command}, sending message to scrape.`);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        // Get the current TAB.
        chrome.tabs.sendMessage(tabs[0].id, { cmd: "run" });
    });
});

/**
 * Message handler.
 * If we return TRUE, we are informing chrome that the result of the call will happen asynch.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!PROFILE_SCRAPPER || !PROFILE_CLASSIFIER) {
        throw new Error("Classes are null!");
    }

    console.log(`Message from ${sender}: ${JSON.stringify(message)}`)
    if (message?.link) {
        PROFILE_SCRAPPER.scrapeProfile(message.link, sendResponse);
    }
    else if (message?.descriptions) {
        PROFILE_CLASSIFIER.classifyProfile(message.descriptions, sendResponse);
    }
    else {
        console.warn(`An unknown message ${message} was received.`);
        return false;
    }
    return true;
});

/**
 * Unload
 */
chrome.runtime.onSuspend.addListener(function () {
    console.log("Unloading.");
});