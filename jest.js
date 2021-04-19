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

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const sendReport = require('actions-utils/send-report');
const gitChangedFiles = require('actions-utils/git-changed-files');
const getBaseRef = require('actions-utils/get-base-ref');
const core = require('@actions/core'); // flow-uncovered-line
const tmp = require('tmp'); // flow-uncovered-line

const parseWithVerboseError = (text /*: string */) => {
    try {
        return JSON.parse(text); // flow-uncovered-line
        // flow-next-uncovered-line
    } catch (err) {
        console.error('>> ❌ Invalid Json! ❌ <<');
        console.error('Jest probably had an error, or something is misconfigured');
        console.error(text);
        throw err; // flow-uncovered-line
    }
};

const runJest = (
    jestBin /*: string */,
    jestOpts /*: Array<string> */,
    spawnOpts /*: any */,
) /*: Promise<void> */ => {
    /* flow-uncovered-block */
    return new Promise((resolve, reject) => {
        core.info(`running ${jestBin} with options ${jestOpts.join(', ')}`);
        const jest = spawn(jestBin, jestOpts, spawnOpts);

        core.group('Running jest');

        jest.stdout.on('data', data => {
            core.info(data.toString());
        });

        jest.stderr.on('data', data => {
            // jest uses stderr for all its output unfortunately
            // https://github.com/facebook/jest/issues/5064
            core.info(data.toString());
        });

        jest.on('close', code => {
            if (code) {
                core.error(`jest exited with code ${code}`);
            }
            core.endGroup();
            resolve();
        });
    });
    /* end flow-uncovered-block */
};

async function run() {
    const jestBin = process.env['INPUT_JEST-BIN'];
    const workingDirectory = process.env['INPUT_CUSTOM-WORKING-DIRECTORY'] || '.';
    const subtitle = process.env['INPUT_CHECK-RUN-SUBTITLE'];
    const findRelatedTests = process.env['INPUT_FIND-RELATED-TESTS'];
    if (!jestBin) {
        core.info(
            `You need to have jest installed, and pass in the the jest binary via the variable 'jest-bin'.`,
        );
        process.exit(1);
        return;
    }

    const baseRef = getBaseRef();
    if (!baseRef) {
        core.info(`No base ref given`); // flow-uncovered-line
        process.exit(1);
        return;
    }

    const files = await gitChangedFiles(baseRef, workingDirectory);
    const validExt = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
    const jsFiles = files.filter(file => validExt.includes(path.extname(file)));
    if (!jsFiles.length) {
        core.info('No JavaScript files changed'); // flow-uncovered-line
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

    const tmpObj = tmp.fileSync();

    const jestOpts = [
        '--json',
        `--outputFile=${tmpObj.name}`,
        '--testLocationInResults',
        '--passWithNoTests',
    ];

    // If we only want related tests, then we explicitly specify that and
    // include all of the files that are to be run.
    if (findRelatedTests) {
        jestOpts.push('--findRelatedTests', ...jsFiles);
    }

    try {
        await runJest(jestBin, jestOpts, {cwd: workingDirectory});
    } catch (err) {
        core.error('An error occurred trying to run jest');
        core.error(err);
        process.exit(1);
    }

    core.info('Parsing json output from jest');

    const output = fs.readFileSync(tmpObj.name, 'utf-8');

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
        output,
    );
    /* end flow-uncovered-block */

    if (data.success) {
        await sendReport('Jest', []);
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
