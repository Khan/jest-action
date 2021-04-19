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

const runJest = (jestBin /*: string */, jestOpts /*: Array<string> */) /*: Promise<void> */ => {
    return new Promise((resolve, reject) => {
        const jest = spawn(jestBin, jestOpts);

        core.group('Jest output');

        jest.stdout.on('data', data => {
            core.info(data.toString());
        });

        jest.stderr.on('data', data => {
            core.error(data.toString());
        });

        jest.on('close', code => {
            if (code) {
                core.error(`jest exited with code ${code}`);
                reject();
            }
            resolve();
        });

        jest.on('exit', code => {
            if (code) {
                core.error(`jest exited with code ${code}`);
            }
            core.error(`stdio are not yet closed`);
            reject();
        });

        core.endGroup();
    });
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

    await runJest(jestBin, jestOpts);

    console.log(`Parsing json output from jest...`);

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
    }*/ = parseWithVerboseError(output);
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
