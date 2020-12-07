// @ts-check

(async () => {

    const os = require('os');
    const path = require('path');
    const glob = require('glob');
    const { v4 } = require('uuid');
    const shell = require('shelljs');
    const protoc = path.dirname(require('protoc/protoc'));
    shell.env.PATH = `${shell.env.PATH}${path.delimiter}${protoc}`;
    shell.env.PATH = `${shell.env.PATH}${path.delimiter}${path.join(__dirname, '..', 'node_modules', '.bin')}`;

    const repository = path.join(os.tmpdir(), `${v4()}-arduino-cli`);
    if (shell.mkdir('-p', repository).code !== 0) {
        shell.exit(1);
    }

    const { owner, repo, commitish } = (() => {
        const pkg = require(path.join(__dirname, '..', 'package.json'));
        if (!pkg) {
            shell.echo(`Could not parse the 'package.json'.`);
            shell.exit(1);
        }

        const { arduino } = pkg;
        if (!arduino) {
            return { owner: 'arduino', repo: 'arduino-cli' };
        }

        const { cli } = arduino;
        if (!cli) {
            return { owner: 'arduino', repo: 'arduino-cli' };
        }

        const { version } = cli;
        if (!version) {
            return { owner: 'arduino', repo: 'arduino-cli' };
        }

        if (typeof version === 'string') {
            return { owner: 'arduino', repo: 'arduino-cli' };
        }

        // We assume an object with `owner`, `repo`, commitish?` properties.
        const { owner, repo, commitish } = version;
        if (!owner) {
            shell.echo(`Could not retrieve 'owner' from ${JSON.stringify(version)}`);
            shell.exit(1);
        }
        if (!repo) {
            shell.echo(`Could not retrieve 'repo' from ${JSON.stringify(version)}`);
            shell.exit(1);
        }

        return { owner, repo, commitish };
    })();

    const url = `https://github.com/${owner}/${repo}.git`;
    shell.echo(`>>> Cloning repository from '${url}'...`);
    if (shell.exec(`git clone ${url} ${repository}`).code !== 0) {
        shell.exit(1);
    }
    shell.echo(`<<< Repository cloned.`);

    const { platform } = process;
    const build = path.join(__dirname, '..', 'build');
    const cli = path.join(build, `arduino-cli${platform === 'win32' ? '.exe' : ''}`);
    const jsonVersion = shell.exec(`${cli} version --format json`).trim();
    if (!jsonVersion) {
        shell.echo(`Could not retrieve the CLI version from ${cli}.`);
        shell.exit(1);
    }
    const version = JSON.parse(jsonVersion).VersionString;
    if (version) {
        shell.echo(`>>> Checking out version: ${version}...`);
        if (shell.exec(`git -C ${repository} checkout ${version} -b ${version}`).code !== 0) {
            shell.exit(1);
        }
        shell.echo(`<<< Checked out version: ${commitish}.`);
    } else if (commitish) {
        shell.echo(`>>> Checking out commitish: ${commitish}...`);
        if (shell.exec(`git -C ${repository} checkout ${commitish}`).code !== 0) {
            shell.exit(1);
        }
        shell.echo(`<<< Checked out commitish: ${commitish}.`);
    }

    shell.echo('>>> Generating TS/JS API from:');
    if (shell.exec(`git -C ${repository} rev-parse --abbrev-ref HEAD`).code !== 0) {
        shell.exit(1);
    }

    const rpc = path.join(repository, 'rpc');
    const out = path.join(__dirname, '..', 'src', 'node', 'cli-protocol');
    shell.mkdir('-p', out);

    const protos = await new Promise(resolve =>
        glob('**/*.proto', { cwd: rpc }, (error, matches) => {
            if (error) {
                shell.echo(error.stack);
                resolve([]);
                return;
            }
            resolve(matches.map(filename => path.join(rpc, filename)));
        }));
    if (!protos || protos.length === 0) {
        shell.echo(`Could not find any .proto files under ${rpc}.`);
        shell.exit(1);
    }

    // Generate JS code from the `.proto` files.
    if (shell.exec(`grpc_tools_node_protoc \
--js_out=import_style=commonjs,binary:${out} \
--grpc_out=generate_package_definition:${out} \
-I ${rpc} \
${protos.join(' ')}`).code !== 0) {
        shell.exit(1);
    }

    // Generate the `.d.ts` files for JS.
    if (shell.exec(`protoc \
--plugin=protoc-gen-ts=${path.resolve(__dirname, '..', 'node_modules', '.bin', `protoc-gen-ts${platform === 'win32' ? '.cmd' : ''}`)} \
--ts_out=generate_package_definition:${out} \
-I ${rpc} \
${protos.join(' ')}`).code !== 0) {
        shell.exit(1);
    }

    shell.echo('<<< Generation was successful.');

})();
