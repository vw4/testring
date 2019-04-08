import {
    IRecorderServerConfig,
    IRecorderServerController,
    RecorderPlugins,
    IChildProcessFork,
    ITransport,
    RecorderWorkerMessages,
} from '@testring/types';

import {
    DEFAULT_RECORDER_HOST,
    DEFAULT_RECORDER_HTTP_PORT,
    DEFAULT_RECORDER_WS_PORT,
} from '@testring/constants';

import * as path from 'path';

import { fork } from '@testring/child-process';
import { generateUniqId } from '@testring/utils';
import { PluggableModule } from '@testring/pluggable-module';
import { loggerClient } from '@testring/logger';

const FRONTEND_PATH = path.dirname(require.resolve('@testring/recorder-frontend'));

export class RecorderServerController extends PluggableModule implements IRecorderServerController {

    private workerID: string;

    private worker: IChildProcessFork;

    private logger = loggerClient.withPrefix('[recorder-server]');

    constructor(private transport: ITransport) {
        super([
            RecorderPlugins.beforeStart,
            RecorderPlugins.afterStart,
            RecorderPlugins.beforeStop,
            RecorderPlugins.afterStop,
        ]);
    }

    private getRouterPath(filepath: string) {
        return path.resolve(__dirname, './routes/', filepath);
    }

    private getConfig(): IRecorderServerConfig {
        return {
            host: DEFAULT_RECORDER_HOST,
            httpPort: DEFAULT_RECORDER_HTTP_PORT,
            wsPort: DEFAULT_RECORDER_WS_PORT,
            router: [
                {
                    method: 'get',
                    mask: '/',
                    handler: this.getRouterPath('index-page'),
                },
                {
                    method: 'get',
                    mask: '/editor',
                    handler: this.getRouterPath('editor-page'),
                },
            ],
            staticRoutes: {
                'recorder-frontend': {
                    'rootPath': '/static',
                    'directory': FRONTEND_PATH,
                },
            },
        };
    }

    private getWorkerID(): string {
        if (!this.workerID) {
            this.workerID = `recorder-${generateUniqId()}`;
        }
        return this.workerID;
    }

    private async startServer() {
        const workerPath = path.resolve(__dirname, 'worker');
        const workerID = this.getWorkerID();

        this.worker = await fork(workerPath, [], { debug: false });

        this.worker.stdout.on('data', (data) => {
            this.logger.log(`[logged] ${data.toString().trim()}`);
        });

        this.worker.stderr.on('data', (data) => {
            this.logger.warn(`[logged] ${data.toString().trim()}`);
        });

        this.transport.registerChild(workerID, this.worker);

        this.logger.debug(`Registered child process ${workerID}`);
    }

    private async stopServer() {
        this.worker.kill();
    }

    public async init() {
        const config = await this.callHook<IRecorderServerConfig>(RecorderPlugins.beforeStart, this.getConfig());

        await this.startServer();

        this.transport.send(this.getWorkerID(), RecorderWorkerMessages.START_SERVER, config);

        let caughtError = null;
        let pending = true;
        let handler = (error) => {
            caughtError = error;
            pending = false;
        };

        this.transport.once(RecorderWorkerMessages.START_SERVER_COMPLETE, (error) => handler(error));

        await new Promise((resolve, reject) => {
            if (pending) {
                handler = (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                };
            } else if (caughtError) {
                reject(caughtError);
            } else {
                resolve();
            }
        });

        await this.callHook(RecorderPlugins.afterStart);
    }

    public async kill() {
        await this.callHook(RecorderPlugins.beforeStop);

        await this.stopServer();

        await this.callHook(RecorderPlugins.afterStop);
    }
}
