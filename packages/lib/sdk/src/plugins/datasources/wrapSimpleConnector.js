import fs from 'fs/promises';
import { EvidenceError } from '../../lib/EvidenceError.js';
import path from 'path';
import { readFileSync, statSync } from 'fs';
/**
 * @param {import("./Datasources.js").Datasource} mod
 * @param {import('./schemas/datasource.schema.js').DatasourceSpecFile & {dir: string}} source
 * @returns {import('./types.js').ProcessSourceFn}
 */
export const wrapSimpleConnector = (mod, source) => {
	if (!('getRunner' in mod))
		throw new EvidenceError(
			'Internal Error',
			'Advanced connector was passed to wrapSimpleConnector. This should not occur'
		);
	/**
	 * @type {import('./types.js').ProcessSourceFn}
	 */
	return async function* () {
		const runner = await mod.getRunner(source.options, source.dir);
		// TODO: Use fsproxy instead of fs
		/**
		 *
		 * @param {string} dir
		 * @returns {AsyncGenerator<import('./types.js').QueryResultTable | EvidenceError>}
		 */
		const processDir = async function* (dir) {
			const sourceFiles = await fs.readdir(dir, { withFileTypes: true });
			for (const sourceFile of sourceFiles) {
				const dirPath = 'parentPath' in sourceFile ? sourceFile.parentPath + '' : sourceFile.path;
				if (sourceFile.name === 'connection.yaml' || sourceFile.name === 'connection.options.yaml')
					continue;
				if (sourceFile.isDirectory()) {
					yield* processDir(path.join(dirPath, sourceFile.name));
					continue;
				}

				if (!sourceFile.isFile()) continue;

				const sourceFilePath = path.join(dirPath, sourceFile.name);
				const sourceFileName = sourceFile.name.split('.').at(0);

				const stat = statSync(sourceFilePath);
				let sourceFileContent;
				if (stat.size > 1024 * 1024 * 128 /* 128 Megabytes */) {
					console.warn('Will not load files larger than 128 Megabytes');
					sourceFileContent = '';
				} else {
					sourceFileContent = readFileSync(sourceFilePath, 'utf-8');
				}
				
				
				try {
					yield {
						name: /** @type {string} */ (sourceFileName),
						content: sourceFileContent,
						columnTypes: [],
						...(await runner(
							sourceFileContent,
							sourceFilePath,
							1000 * 1000 // TODO: BatchSize configurable? Perhaps per-source plugin or per connection
						))
					};
				} catch (e) {
					let message = 'Unknown Error';
					if (e instanceof Error) message = e.message;
					if (e instanceof EvidenceError) {
						e.metadata.tableName = sourceFileName;
						yield e;
					}
					yield new EvidenceError(
						message,
						[sourceFileName ?? ''],
						{ cause: e },
						{ tableName: sourceFileName }
					);
				}
			}
		};

		yield* processDir(source.dir);
	};
};
