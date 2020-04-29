#!/usr/bin/env node
// @flow

/**
 * This action runs `flow` and lints against uncovered expressions.
 *
 * It uses `send-report.js` to support both running locally (reporting to
 * stdout) and under Github Actions (adding annotations to files in the GitHub
 * UI).
 */

// $FlowFixMe: shhhhh
require('@babel/register'); // flow-uncovered-line

const checkFile = require('../lib/flow-coverage-linter');

const sendReport = require('../lib/send-report');
const getBaseRef = require('../lib/get-base-ref');
const gitChangedFiles = require('../lib/git-changed-files');

async function run(flowBin) {
    const files = await gitChangedFiles(await getBaseRef(), '.');
    const jsFiles = files.filter(file => file.endsWith('.js'));
    if (!jsFiles.length) {
        console.log('No changed files');
        return;
    }
    const allAnnotations = [];
    for (const file of jsFiles) {
        const annotations = await checkFile(flowBin, file);
        allAnnotations.push(...annotations);
    }
    await sendReport('Flow-coverage', allAnnotations);
}

// Deprecated -- included for backwards compatability with arcanist, until
// we get completely off of phabricator.
const runArcanist = async (flowBin, files) => {
    //let failed = false; // MUSTDO (Lilli to Jared): Was there plans to do something with this variable or can we delete it? jared: "oh yeah I was gonna have the exit code match the failed status"
    for (const filePath of files) {
        const warnings = await checkFile(flowBin, filePath);
        if (!warnings.length) {
            continue;
        }
        //failed = true;

        warnings.forEach(warning => {
            console.log(
                `${warning.path}:::${warning.message}:::${warning.offset}`,
            );
        });
    }
};

const [_, __, flowBin, ...argvFiles] = process.argv;

if (argvFiles.length) {
    // arc lint is running us
    runArcanist(flowBin, argvFiles);
} else {
    // flow-next-uncovered-line
    run(flowBin).catch(err => {
        console.error(err); // flow-uncovered-line
        process.exit(1);
    });
}
