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

const path = require('path');
const sendReport = require('actions-utils/send-report');
const execProm = require('actions-utils/exec-prom');
const gitChangedFiles = require('actions-utils/git-changed-files');
const getBaseRef = require('actions-utils/get-base-ref');
const core = require("@actions/core"); // flow-uncovered-line

const parseWithVerboseError = (text, stderr) => {
    try {
        return JSON.parse(text); // flow-uncovered-line
        // flow-next-uncovered-line
    } catch (err) {
        console.error('>> ❌ Invalid Json! ❌ <<');
        console.error('Jest probably had an error, or something is misconfigured');
        console.error(stderr);
        console.error(text);
        throw err; // flow-uncovered-line
    }
};

async function run() {
    const jestBin = process.env['INPUT_JEST-BIN'];
    const workingDirectory = process.env['INPUT_CUSTOM-WORKING-DIRECTORY'];
    const subtitle = process.env['INPUT_CHECK-RUN-SUBTITLE'];
    const findRelatedTests = process.env['INPUT_FIND-RELATED-TESTS'];
    if (!jestBin) {
        console.error(
            `You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`,
        );
        process.exit(1);
        return;
    }

    const baseRef = getBaseRef();
    if (!baseRef) {
        console.error(`No base ref given`);
        process.exit(1);
        return;
    }

    const files = await gitChangedFiles(baseRef, workingDirectory || '.');
    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter(file => validExt.includes(path.extname(file)));
    if (!jsFiles.length) {
        console.log('No JavaScript files changed');
        return;
    }

    /* flow-uncovered-block */
    // Log which files are being tested by jest.
    const cwd = process.cwd();
    core.startGroup('Running jest on the following files:');
    for (const file of jsFiles) {
        core.info(path.relative(cwd, file));
    }
    core.endGroup();
    /* end flow-uncovered-block */

    // Build the Jest command
    const jestCmd = [jestBin, '--json', '--testLocationInResults', '--passWithNoTests'];

    // If we only want related tests, then we explicitly specify that and
    // include all of the files that are to be run.
    if (findRelatedTests) {
        jestCmd.push('--findRelatedTests', ...jsFiles);
    }

    const {stdout, stderr} = await execProm(jestCmd.join(' '), {
        rejectOnError: false,
        cwd: workingDirectory || '.',
    });

    if (stdout === null || stdout === '') {
        console.error(`\nThere was an error running jest${stderr ? ':\n\n' + stderr : ''}`);
        process.exit(1);
        return;
    }

    console.log(`Parsing json output from jest...`);

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
    }*/ = parseWithVerboseError(
        stdout,
        stderr,
    );
    /* end flow-uncovered-block */

    if (data.success) {
        await sendReport('Jest', []);
        return;
    }

    /* flow-uncovered-block */
    // Log which files are being tested by jest.
    core.startGroup('Output from jest:');
    core.info(JSON.stringify(data, null, 2));
    core.endGroup();
    /* end flow-uncovered-block */

    const annotations = [];
    for (const testResult of data.testResults) {
        if (testResult.status !== 'failed') {
            continue;
        }
        let hadLocation = false;
        const path = testResult.name;
        for (const assertionResult of testResult.assertionResults) {
            if (assertionResult.status === 'failed' && assertionResult.location) {
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
    await sendReport(`Jest${subtitle ? ' - ' + subtitle : ''}`, annotations);
}

// flow-next-uncovered-line
run().catch(err => {
    console.error(err); // flow-uncovered-line
    process.exit(1);
});
