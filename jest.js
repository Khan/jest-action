#!/usr/bin/env node
// @flow

/**
 * This action runs `jest` and reports any type errors it encounters.
 *
 * It expects the path to the `jest` binary to be provided as the first
 * argument, and it runs `jest` in the current working directory.
 *
 * It uses `send-report.js` to support both running locally (reporting to
 * stdout) and under Github Actions (adding annotations to files in the GitHub
 * UI).
 */

// $FlowFixMe: shhhhh
require('@babel/register'); // flow-uncovered-line

const sendReport = require('./send-report');
const execProm = require('./exec-prom');

async function run() {
    const jestBin = process.env['INPUT_JEST-BIN'];
    if (!jestBin) {
        console.error(
            `You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`,
        );
        process.exit(1);
        return;
    }
    const {stdout} = await execProm(`${jestBin} --json`);
    /* flow-uncovered-block */
    const data /*:{
        testResults: Array<{
            name: string,
            assertionResults: Array<{
                status: string,
                location: {line: number, column: number},
                failureMessages: Array<string>,
            }>,
            message: string,
            status: string,
        }>,
        success: bool,
    }*/ = JSON.parse(
        stdout,
    );
    /* end flow-uncovered-block */
    if (data.success) {
        console.log('All tests passed');
        return;
    }
    const annotations = [];
    for (const testResult of data.testResults) {
        if (testResult.status !== 'failed') {
            continue;
        }
        let hadLocation = false;
        const path = testResult.name;
        for (const assertionResult of testResult.assertionResults) {
            if (
                assertionResult.status === 'failed' &&
                assertionResult.location
            ) {
                hadLocation = true;
                annotations.push({
                    path,
                    start: assertionResult.location,
                    end: assertionResult.location,
                    annotationLevel: 'failure',
                    message: assertionResult.failureMessages.join('\n\n'),
                });
            }
        }
        if (!hadLocation) {
            console.log('no location,');
            annotations.push({
                path,
                start: {line: 1, column: 0},
                end: {line: 1, column: 0},
                annotationLevel: 'failure',
                message: testResult.message,
            });
        }
    }
    await sendReport('Jest', annotations);
}

// flow-next-uncovered-line
run().catch(err => {
    console.error(err); // flow-uncovered-line
    process.exit(1);
});