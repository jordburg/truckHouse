const globalLogMessages = [];
const onSystemHasStarted = () => {
    _systemHasStarted = true;
    const loggerButton = document.querySelector('.startup-log-button');
    if (loggerButton != null) {
        loggerButton.style.display = 'none';
    }
};
let _systemHasStarted = false;
(function (window) {
    const _prettyLog = (object) => {
        if (object == null) {
            return '';
        }
        if (Array.isArray(object)) {
            let result = '';
            let index = 0;
            for (const item of object) {
                result += _simpleStringify(item);
                index++;
                if (index < object.length) {
                    result += ', ';
                }
            }
            return result;
        }
        else if (typeof (object) !== 'string') {
            return _simpleStringify(object);
        }
        return object;
    };
    const _simpleStringify = (object) => {
        const simpleObject = {};
        for (const prop in object) {
            if (!Object.prototype.hasOwnProperty.call(object, prop)) {
                continue;
            }
            if (Array.isArray(object[prop])) {
                const array = object[prop];
                simpleObject[prop] = JSON.stringify(array);
                continue;
            }
            if (typeof (object[prop]) === 'object') {
                continue;
            }
            if (typeof (object[prop]) === 'function') {
                continue;
            }
            simpleObject[prop] = object[prop];
        }
        return JSON.stringify(simpleObject);
    };
    const _consoleLogOverride = (originalLog, message, optionalParams) => {
        try {
            const timestamp = `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
            if (optionalParams != null && optionalParams.length > 0) {
                originalLog(message, ...optionalParams);
                globalLogMessages.push(`${timestamp} ${_prettyLog(message)} , ${_prettyLog(optionalParams)}`);
            }
            else {
                originalLog(message);
                globalLogMessages.push(`${timestamp} ${_prettyLog(message)}`);
            }
            if (globalLogMessages.length > 100) {
                globalLogMessages.splice(0, 1);
            }
            if (!_systemHasStarted) {
                const loggerButton = document.querySelector('.startup-log-button');
                if (loggerButton != null) {
                    loggerButton.style.display = 'block';
                }
            }
        }
        catch (_a) {
        }
    };
    const originalErrorLog = console.error;
    console.error = (message, ...optionalParams) => _consoleLogOverride(originalErrorLog, message, optionalParams);
    const originalDebugLog = console.log;
    console.log = (message, ...optionalParams) => _consoleLogOverride(originalDebugLog, message, optionalParams);
    window.onerror = (msg, url, line) => {
        console.error(`Error: ${msg} - line: ${line} - url: ${url}`);
    };
    window.addEventListener('unhandledrejection', (event) => {
        if (event.reason != null && event.reason.name === 'Error') {
            console.error('Unhandled promise rejection:', [event.reason['message'], event.reason['stack']]);
        }
        else {
            console.error('Unhandled promise rejection:', event.reason);
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        const body = document.querySelector('body');
        const loggerButton = document.createElement('div');
        loggerButton.classList.add('startup-log-button');
        loggerButton.style.top = '0';
        loggerButton.style.left = '0';
        loggerButton.style.position = 'fixed';
        loggerButton.style.zIndex = '9999';
        loggerButton.style.display = 'none';
        loggerButton.style.paddingLeft = '10px';
        loggerButton.style.backgroundColor = 'whitesmoke';
        loggerButton.style.width = '10px';
        loggerButton.style.height = '35px';
        loggerButton.style.opacity = '0.8';
        body.appendChild(loggerButton);
        loggerButton.addEventListener('click', (event) => {
            event.stopPropagation();
            let loggerDiv = document.querySelector('.startup-log-view');
            if (loggerDiv == null) {
                loggerDiv = document.createElement('div');
                loggerDiv.classList.add('startup-log-view');
                loggerDiv.style.position = 'fixed';
                loggerDiv.style.zIndex = '9989';
                loggerDiv.style.color = 'white';
                loggerDiv.style.top = '0';
                loggerDiv.style.left = '0';
                loggerDiv.style.width = '100%';
                loggerDiv.style.height = '100;';
                loggerDiv.style.padding = '15px';
                loggerDiv.style.display = 'none';
                loggerDiv.style.fontSize = 'x-large';
                body.appendChild(loggerDiv);
            }
            loggerDiv.innerHTML = '';
            if (loggerDiv.style.display === 'block') {
                loggerDiv.style.display = 'none';
            }
            else {
                const length = globalLogMessages.length;
                for (let i = length - 1; i >= 0; i--) {
                    const message = globalLogMessages[i];
                    const node = document.createElement('div');
                    const textNode = document.createTextNode(message);
                    node.appendChild(textNode);
                    loggerDiv.appendChild(node);
                }
                loggerDiv.style.display = 'block';
            }
            return 0;
        });
    });
}(window));
