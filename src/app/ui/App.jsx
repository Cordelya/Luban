import PropTypes from 'prop-types';
import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { HashRouter, Route, Switch } from 'react-router-dom';

import { actions as cncActions } from '../flux/cnc';
import { actions as editorActions } from '../flux/editor';
import { actions as laserActions } from '../flux/laser';
import { actions as machineActions } from '../flux/machine';
import { actions as printingActions } from '../flux/printing';
import { actions as settingActions } from '../flux/setting';
import { actions as textActions } from '../flux/text';
import { actions as workspaceActions } from '../flux/workspace';
import { Server } from '../flux/workspace/Server';
import { Canvas2dZoom } from '../lib/canvas2d-zoom/index';
import { logErrorToGA } from '../lib/gaEvent';
import { ShortcutHandlerPriority, ShortcutManager, PREDEFINED_SHORTCUT_ACTIONS } from '../lib/shortcut';
import UniApi from '../lib/uni-api';

import { ToastContainer } from './components/Toast';
import AppLayout from './layouts/AppLayout';
import Cnc from './pages/Cnc';
import HomePage from './pages/HomePage';
import Laser from './pages/Laser';
import Settings from './pages/Settings';
import Workspace from './pages/Workspace';
import { PrintMainPage } from './pages/print-main';

Canvas2dZoom.register();

class App extends PureComponent {
    static propTypes = {
        resetUserConfig: PropTypes.func.isRequired,
        machineInit: PropTypes.func.isRequired,
        functionsInit: PropTypes.func.isRequired,
        textInit: PropTypes.func.isRequired,
        shouldCheckForUpdate: PropTypes.bool.isRequired,
        enableShortcut: PropTypes.bool.isRequired,
        updateMultipleEngine: PropTypes.func.isRequired,
        menuDisabledCount: PropTypes.number,

        workspaceInit: PropTypes.func.isRequired,
    };

    state = { hasError: false };

    router = React.createRef();

    shortcutHandler = {
        title: this.constructor.name,
        isActive: () => this.props.enableShortcut,
        // active: false,
        priority: ShortcutHandlerPriority.App,
        shortcuts: {
            // TODO: implement file menu actions
            [PREDEFINED_SHORTCUT_ACTIONS.OPEN]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:open-file');
                }
            },
            [PREDEFINED_SHORTCUT_ACTIONS.SAVE]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:save');
                }
            },
            [PREDEFINED_SHORTCUT_ACTIONS.SAVE_AS]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:save-as-file');
                }
            },
            [PREDEFINED_SHORTCUT_ACTIONS.IMPORT]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:import');
                }
            },
            [PREDEFINED_SHORTCUT_ACTIONS.EXPORT_MODELS]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:export-model');
                }
            },
            [PREDEFINED_SHORTCUT_ACTIONS.EXPORT_GCODE]: () => {
                if (this.props.menuDisabledCount <= 0) {
                    UniApi.Event.emit('appbar-menu:export-gcode');
                }
            },
            'RESETUSERCONFIG': { // reset user config, which equivalent to fully reinstallation
                keys: ['alt+shift+r'],
                callback: () => {
                    this.props.resetUserConfig();
                }
            },
            'LISTALLSHORTCUTS': {
                keys: ['mod+alt+k l'],
                callback: () => {
                    ShortcutManager.printList();
                }
            },
            'MULTIPLEENGINE': {
                keys: ['mod+alt+k e'],
                callback: () => {
                    this.props.updateMultipleEngine();
                }
            }
        }
    };

    componentDidMount() {
        // disable select text on document
        document.onselectstart = () => {
            return false;
        };
        // init machine module
        // TODO: move init to proper page
        this.props.machineInit();
        this.props.workspaceInit();

        this.props.functionsInit();
        this.props.textInit();
        UniApi.Window.initWindow();
        // auto update
        setTimeout(() => {
            if (this.props.shouldCheckForUpdate) {
                UniApi.Update.checkForUpdate();
            }
        }, 200);

        ShortcutManager.register(this.shortcutHandler);
        Server.closeServerAfterWindowReload();
    }

    static getDerivedStateFromError() {
        // Update state so the next render will show the fallback UI.
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error('error', error, errorInfo);
        logErrorToGA(errorInfo);
    }

    render() {
        if (this.state.hasError) {
            // You can render any custom fallback UI
            return <h1>Something went wrong. Please reload the app</h1>;
        }

        return (
            <HashRouter ref={this.router}>
                <AppLayout>
                    <Switch>
                        <Route path="/" exact component={HomePage} />
                        <Route path="/workspace" component={Workspace} />
                        <Route path="/printing" component={PrintMainPage} />
                        <Route path="/laser" component={Laser} />
                        <Route path="/cnc" component={Cnc} />
                        <Route path="/settings" component={Settings} />
                        <Route component={HomePage} />
                    </Switch>
                    <ToastContainer
                        position="top-center"
                        autoClose={5000}
                        hideProgressBar
                        newestOnTop
                        closeOnClick
                        rtl={false}
                        pauseOnFocusLoss
                        draggable
                        pauseOnHover
                    />
                </AppLayout>
            </HashRouter>
        );
    }
}

const mapStateToProps = (state) => {
    const machineInfo = state.machine;
    const { menuDisabledCount } = state.appbarMenu;
    let enableShortcut = state[window.location.hash.slice(2)]?.enableShortcut;
    enableShortcut = (typeof enableShortcut === 'undefined' ? true : enableShortcut);
    const { shouldCheckForUpdate } = machineInfo;
    return {
        enableShortcut,
        menuDisabledCount,
        shouldCheckForUpdate
    };
};
const mapDispatchToProps = (dispatch) => {
    return {
        resetUserConfig: () => dispatch(settingActions.resetUserConfig()),
        machineInit: () => dispatch(machineActions.init()),
        laserInit: () => dispatch(laserActions.init()),
        cncInit: () => dispatch(cncActions.init()),
        printingInit: () => dispatch(printingActions.init()),
        workspaceInit: () => dispatch(workspaceActions.init()),
        textInit: () => dispatch(textActions.init()),
        functionsInit: () => {
            dispatch(editorActions.initSelectedModelListener('laser'));
            dispatch(editorActions.initSelectedModelListener('cnc'));
        },
        updateMultipleEngine: () => dispatch(machineActions.updateMultipleEngine())
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(App);
