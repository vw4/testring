const seleniumConfig = require('./config');

module.exports = async (config) => {
    const defConfig = await seleniumConfig(config);

    const screenshotPath = './screenshots';

    const plugins = [
        ...defConfig.plugins,
        [
            'fs-store',
            {
                staticPaths: {
                    screenshot: screenshotPath,
                },
            },
        ],
    ];

    return {
        ...defConfig,
        screenshotPath,
        screenshots: 'enable',
        tests: 'test/selenium/test-screenshots/*.spec.js',
        plugins,
    };
};
