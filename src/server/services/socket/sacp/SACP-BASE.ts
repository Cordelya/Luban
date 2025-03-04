import { find, includes } from 'lodash';
import net from 'net';
import { readString, readUint16, readUint8 } from 'snapmaker-sacp-sdk/helper';
import {
    AirPurifierInfo,
    CncSpeedState,
    CoordinateInfo,
    CoordinateSystemInfo,
    EnclosureInfo,
    ExtruderInfo,
    GcodeCurrentLine,
    GetHotBed,
    LaserTubeState
} from 'snapmaker-sacp-sdk/models';
// import GetWorkSpeed from 'snapmaker-sacp-sdk/models/GetWorkSpeed';
import { ResponseCallback } from 'snapmaker-sacp-sdk';
import { Direction } from 'snapmaker-sacp-sdk/models/CoordinateInfo';
import Business, { CoordinateType } from './Business';
import SocketServer from '../../../lib/SocketManager';
import logger from '../../../lib/logger';
import {
    A400_HEADT_BED_FOR_SM2,
    AIR_PURIFIER_MODULES,
    CNC_MODULE,
    COORDINATE_AXIS,
    EMERGENCY_STOP_BUTTON,
    ENCLOSURE_MODULES,
    HEAD_CNC,
    HEAD_LASER,
    HEAD_PRINTING,
    HEADT_BED_FOR_SM2,
    LASER_MODULE,
    LOAD_FIMAMENT,
    PRINTING_MODULE,
    ROTARY_MODULES,
    UNLOAD_FILAMENT,
    WORKFLOW_STATE_RUNNING,
    WORKFLOW_STATUS_MAP
} from '../../../../app/constants';
import {
    AIR_PURIFIER,
    MODULEID_MAP,
    ENCLOSURE_FOR_ARTISAN,
    MODULEID_TOOLHEAD_MAP,
    DUAL_EXTRUDER_TOOLHEAD_FOR_SM2,
    STANDARD_CNC_TOOLHEAD_FOR_SM2,
    LEVEL_ONE_POWER_LASER_FOR_SM2,
    LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2,
    LEVEL_TWO_POWER_LASER_FOR_SM2,
    ENCLOSURE_FOR_SM2,
    isDualExtruder
} from '../../../../app/constants/machines';


import { EventOptions, MarlinStateData } from '../types';
import {
    COMPLUTE_STATUS,
    SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2,
    WORKFLOW_STATE_IDLE,
    WORKFLOW_STATE_PAUSED
} from '../../../constants';

const log = logger('lib:SocketBASE');

class SocketBASE {
    private heartbeatTimer;

    public socket: SocketServer;

    public sacpClient: Business;

    public subscribeLogCallback: ResponseCallback;

    public subscribeHeartCallback: ResponseCallback;

    public subscribeNozzleCallback: ResponseCallback;

    public subscribeHotBedCallback: ResponseCallback;

    public subscribeCoordinateCallback: ResponseCallback;

    public subscribeCncSpeedStateCallback: ResponseCallback;

    public subscribeLaserPowerCallback: ResponseCallback;

    public subscribeGetCurrentGcodeLineCallback: ResponseCallback;

    public subscribeEnclosureInfoCallback: ResponseCallback;

    public subscribePurifierInfoCallback: ResponseCallback;

    private filamentAction = false;

    private filamentActionType = 'load';

    private moduleInfos: {};

    public currentWorkNozzle: number;

    private resumeGcodeCallback: any = null;

    public readyToWork = false;

    public headType: string = HEAD_PRINTING;

    public cncTargetSpeed: number;

    // gcode total lines
    public totalLine: number | null = null;

    public estimatedTime: number | null = null;

    public startTime: any;

    public machineStatus: string = WORKFLOW_STATE_IDLE;

    public startHeartbeatBase = async (sacpClient: Business, client?: net.Socket) => {
        this.sacpClient = sacpClient;
        let stateData: MarlinStateData = {};
        let statusKey = 0;
        const moduleStatusList = {
            rotaryModule: false,
            airPurifier: false,
            emergencyStopButton: false,
            enclosure: false
        };
        this.sacpClient.logFeedbackLevel(2).then(({ response }) => {
            log.info(`logLevel, ${response}`);
            if (response.result === 0) {
                this.subscribeLogCallback = (data) => {
                    const result = readString(data.response.data, 1).result;
                    if (result === null) {
                        log.warn('subscribed log is null');
                    }
                    // this.socket && this.socket.emit('serialport:read', { data: result });
                };
                this.sacpClient.subscribeLogFeedback({ interval: 60000 }, this.subscribeLogCallback);
            }
        });
        this.sacpClient.setHandler(0x01, 0x36, ({ param }) => {
            const isHomed = readUint8(param, 0);
            stateData = {
                ...stateData,
                isHomed: !isHomed
            };
            if (stateData.headType !== HEAD_PRINTING) {
                this.sacpClient.updateCoordinate(CoordinateType.WORKSPACE).then(({ response }) => {
                    log.info(`updateCoordinateType, ${response.result}`);
                });
            }
            this.socket && this.socket.emit('move:status', { isHoming: false });
        });
        this.sacpClient.setHandler(0x04, 0x00, ({ param }) => {
            const level = readUint8(param, 0);
            const owner = readUint16(param, 1);
            const error = readUint8(param, 3);
            this.socket && this.socket.emit('manager:error', { level, owner, errorCode: error });
        });
        this.subscribeHeartCallback = async (data) => {
            statusKey = readUint8(data.response.data, 0);

            if (this.heartbeatTimer) {
                clearTimeout(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }

            this.heartbeatTimer = setTimeout(() => {
                client && client.destroy();
                log.info('TCP close');
                this.socket && this.socket.emit('connection:close');
            }, 10000);

            this.machineStatus = WORKFLOW_STATUS_MAP[statusKey];

            // TODO: Refactor this
            this.socket && this.socket.emit('Marlin:state', {
                state: {
                    ...stateData,
                    moduleStatusList,
                    status: WORKFLOW_STATUS_MAP[statusKey],
                    moduleList: moduleStatusList,
                }
            });
        };
        this.sacpClient.subscribeHeartbeat({ interval: 1000 }, this.subscribeHeartCallback).then((res) => {
            log.info(`subscribe heartbeat success: ${res.code}`);
        });
        await this.sacpClient.getModuleInfo().then(({ data: moduleInfos }) => {
            // log.info(`revice moduleInfo: ${data.response}`);
            stateData.airPurifier = false;

            const toolHeadModules = [];

            moduleInfos.forEach(module => {
                if (includes(EMERGENCY_STOP_BUTTON, module.moduleId)) {
                    moduleStatusList.emergencyStopButton = true;
                }
                if (includes(ENCLOSURE_MODULES, module.moduleId)) {
                    moduleStatusList.enclosure = true;
                }
                if (includes(ROTARY_MODULES, module.moduleId)) {
                    moduleStatusList.rotaryModule = true;
                }
                if (includes(AIR_PURIFIER_MODULES, module.moduleId)) {
                    stateData.airPurifier = true;
                    // need to update airPurifier status
                }
                if (includes(PRINTING_MODULE, module.moduleId)) {
                    stateData.headType = HEAD_PRINTING;
                    this.headType = HEAD_PRINTING;
                    toolHeadModules.push(module);
                } else if (includes(LASER_MODULE, module.moduleId)) {
                    stateData.headType = HEAD_LASER;
                    this.headType = HEAD_LASER;
                    toolHeadModules.push(module);
                } else if (includes(CNC_MODULE, module.moduleId)) {
                    stateData.headType = HEAD_CNC;
                    this.headType = HEAD_CNC;
                    toolHeadModules.push(module);
                }

                const keys = Object.keys(MODULEID_MAP);
                if (includes(keys, String(module.moduleId))) {
                    if (!this.moduleInfos) {
                        this.moduleInfos = {};
                    }
                    // TODO: Consider more than one tool head modules
                    this.moduleInfos[MODULEID_MAP[module.moduleId]] = module;
                }
            });

            if (toolHeadModules.length === 0) {
                stateData.toolHead = MODULEID_TOOLHEAD_MAP['0']; // default extruder
            } else if (toolHeadModules.length === 1) {
                const module = toolHeadModules[0];
                stateData.toolHead = MODULEID_TOOLHEAD_MAP[module.moduleId];
            } else if (toolHeadModules.length === 2) {
                // hard-coded IDEX head for J1, refactor this later.
                stateData.toolHead = MODULEID_TOOLHEAD_MAP['00'];
            }
        });
        this.subscribeHotBedCallback = (data) => {
            const hotBedInfo = new GetHotBed().fromBuffer(data.response.data);
            // log.info(`hotbedInfo, ${hotBedInfo}`);
            stateData = {
                ...stateData,
                heatedBedTargetTemperature: hotBedInfo?.zoneList[0]?.targetTemzperature || 0,
                heatedBedTemperature: hotBedInfo?.zoneList[0]?.currentTemperature || 0
            };
        };
        this.sacpClient.subscribeHotBedTemperature({ interval: 1000 }, this.subscribeHotBedCallback).then(res => {
            log.info(`subscribe hotbed success: ${res}`);
        });
        this.subscribeNozzleCallback = (data) => {
            const nozzleInfo = new ExtruderInfo().fromBuffer(data.response.data);

            if (nozzleInfo.extruderList.length === 1) {
                const extruderInfo = nozzleInfo.extruderList[0];
                const extruderIndex = nozzleInfo.key;

                const nozzleSizeList = stateData.nozzleSizeList || [];

                if (extruderInfo.status === 1) {
                    this.currentWorkNozzle = extruderIndex;
                }
                if (extruderInfo.diameter !== nozzleSizeList[extruderIndex]) {
                    nozzleSizeList[extruderIndex] = extruderInfo.diameter;
                }

                if (extruderIndex === 0) {
                    stateData = {
                        ...stateData,
                        nozzleSizeList,
                        nozzleTemperature: extruderInfo.currentTemperature,
                        nozzleTargetTemperature: extruderInfo.targetTemperature,
                        currentWorkNozzle: this.currentWorkNozzle,
                    };
                } else {
                    stateData = {
                        ...stateData,
                        nozzleSizeList,
                        nozzleRightTargetTemperature: extruderInfo?.targetTemperature || 0,
                        nozzleRightTemperature: extruderInfo?.currentTemperature || 0,
                        currentWorkNozzle: this.currentWorkNozzle,
                    };
                }
            } else if (nozzleInfo.extruderList.length === 2) {
                const leftInfo = find(nozzleInfo.extruderList, { index: 0 });
                const rightInfo = find(nozzleInfo.extruderList, { index: 1 }) || {};

                this.currentWorkNozzle = rightInfo.status === 1 ? 1 : 0;
                stateData = {
                    ...stateData,
                    nozzleSizeList: [leftInfo.diameter, rightInfo.diameter],
                    nozzleTemperature: leftInfo.currentTemperature,
                    nozzleTargetTemperature: leftInfo.targetTemperature,
                    nozzleRightTargetTemperature: rightInfo?.targetTemperature || 0,
                    nozzleRightTemperature: rightInfo?.currentTemperature || 0,
                    currentWorkNozzle: this.currentWorkNozzle
                };
            }
        };
        this.sacpClient.subscribeNozzleInfo({ interval: 1000 }, this.subscribeNozzleCallback).then(res => {
            log.info(`subscribe nozzle success: ${res}`);
        });
        this.subscribeCoordinateCallback = (data) => {
            // log.info(`revice coordinate: ${data.response}`);
            const response = data.response;
            const coordinateInfos = new CoordinateSystemInfo().fromBuffer(response.data);
            const currentCoordinate = coordinateInfos.coordinates;
            const originCoordinate = coordinateInfos.originOffset;
            const pos = {
                x: currentCoordinate[0].value,
                y: currentCoordinate[1].value,
                z: currentCoordinate[2].value,
                b: currentCoordinate[4].value,
                isFourAxis: moduleStatusList.rotaryModule
            };
            const originOffset = {
                x: originCoordinate[0].value,
                y: originCoordinate[1].value,
                z: originCoordinate[2].value,
                b: originCoordinate[4].value
            };
            const isHomed = !(coordinateInfos?.homed); // 0: homed, 1: need to home
            stateData = {
                ...stateData,
                pos,
                originOffset,
                isHomed,
                // isMoving: false
            };
        };
        this.sacpClient.subscribeCurrentCoordinateInfo({ interval: 1000 }, this.subscribeCoordinateCallback).then(res => {
            log.info(`subscribe coordination success: ${res}`);
        });
        this.subscribeCncSpeedStateCallback = (data) => {
            const cncSpeedState = new CncSpeedState().fromBuffer(data.response.data);
            const { targetSpeed, currentSpeed } = cncSpeedState;
            this.cncTargetSpeed = targetSpeed;
            stateData = {
                ...stateData,
                cncTargetSpindleSpeed: targetSpeed,
                cncCurrentSpindleSpeed: currentSpeed
            };
        };
        this.sacpClient.subscribeCncSpeedState({ interval: 1000 }, this.subscribeCncSpeedStateCallback).then(res => {
            log.info(`subscribe cnc speed state success: ${res}`);
        });
        this.subscribeLaserPowerCallback = (data) => {
            const laserTubeState = new LaserTubeState().fromBuffer(data.response.data.slice(1));
            const { currentPower: laserCurrentPower, targetPower: laserTargetPower } = laserTubeState;
            stateData = {
                ...stateData,
                laserPower: laserCurrentPower,
                laserTargetPower
            };
        };
        this.sacpClient.subscribeLaserPowerState({ interval: 1000 }, this.subscribeLaserPowerCallback).then(res => {
            log.info(`subscribe laser power state success: ${res}`);
        });

        this.subscribeGetCurrentGcodeLineCallback = async ({ response }) => {
            if (!this.totalLine || !this.estimatedTime) {
                this.sacpClient.getPrintingFileInfo().then((result) => {
                    const { totalLine, estimatedTime } = result.data;
                    if (totalLine) {
                        this.totalLine = totalLine;
                    }
                    if (estimatedTime) {
                        this.estimatedTime = estimatedTime;
                    }
                });
            }
            const { currentLine } = new GcodeCurrentLine().fromBuffer(response.data);
            const progress = Math.round((currentLine / this.totalLine) * 100) / 100;
            const sliceTime = new Date().getTime() - this.startTime;
            const remainingTime = (1 - (progress)) * progress * (this.estimatedTime * 1000) / progress + (1 - progress) * (1 - progress) * sliceTime;
            const data = {
                sent: currentLine,
                total: this.totalLine,
                elapsedTime: sliceTime,
                estimatedTime: this.estimatedTime * 1000,
                progress: currentLine === this.totalLine ? 1 : progress,
                remainingTime: remainingTime,
                printStatus: currentLine === this.totalLine ? COMPLUTE_STATUS : ''
            };
            includes([WORKFLOW_STATE_RUNNING, WORKFLOW_STATE_PAUSED], this.machineStatus) && this.socket && this.socket.emit('sender:status', ({ data }));
        };
        this.sacpClient.subscribeGetPrintCurrentLineNumber({ interval: 1000 }, this.subscribeGetCurrentGcodeLineCallback);
        this.sacpClient.subscribeGetPrintingTime({ interval: 1000 }, (response) => {
            const sliceTime = response.response.data.readUInt32LE(0);
            this.startTime = new Date().getTime() - sliceTime * 1000;
        });
        this.subscribeEnclosureInfoCallback = (data) => {
            const { ledValue, testStatus, fanlevel } = new EnclosureInfo().fromBuffer(data.response.data);
            let headTypeKey = 0;
            switch (this.headType) {
                case HEAD_PRINTING:
                    headTypeKey = 0;
                    break;
                case HEAD_LASER:
                    headTypeKey = 1;
                    break;
                case HEAD_CNC:
                    headTypeKey = 2;
                    break;
                default:
                    break;
            }
            const { State } = find(testStatus, { workType: headTypeKey });
            stateData = {
                ...stateData,
                ledValue,
                fanLevel: fanlevel,
                isDoorEnable: State,
            };
        };
        this.sacpClient.subscribeEnclosureInfo({ interval: 1000 }, this.subscribeEnclosureInfoCallback).then(res => {
            log.info(`subscribe enclosure info, ${res.response.result}`);
        });
        this.subscribePurifierInfoCallback = (data) => {
            const { airPurifierStatus: { fanState, speedLevel, lifeLevel, powerState } } = new AirPurifierInfo().fromBuffer(data.response.data);
            stateData = {
                ...stateData,
                airPurifierHasPower: powerState,
                airPurifierSwitch: fanState,
                airPurifierFanSpeed: speedLevel,
                airPurifierFilterHealth: lifeLevel - 1
            };
        };
        this.sacpClient.subscribePurifierInfo({ interval: 1000 }, this.subscribePurifierInfoCallback).then(res => {
            log.info(`subscribe purifier info, ${res.response.result}`);
        });
    };

    public setROTSubscribeApi = () => {
        log.info('ack ROT api');
        this.sacpClient.handlerCoordinateMovementReturn(() => {
            this.socket && this.socket.emit('move:status', { isMoving: false });
            if (this.readyToWork) {
                log.info('ready to work');
                this.socket && this.socket.emit('connection:headBeginWork', { headType: this.headType });
                this.readyToWork = false;
            }
        });
        this.sacpClient.handlerSwitchNozzleReturn((data) => {
            if (this.filamentAction && data === 0) {
                const toolHead = this.moduleInfos
                    && (this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2] || this.moduleInfos[SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2]);
                // || this.moduleInfos[HEADT_BED_FOR_SM2]); //
                if (this.filamentActionType === UNLOAD_FILAMENT) {
                    this.sacpClient.ExtruderMovement(toolHead.key, 0, 6, 200, 60, 150).then(({ response }) => {
                        if (response.result !== 0) {
                            this.socket && this.socket.emit('connection:unloadFilament');
                        }
                    });
                } else {
                    this.sacpClient.ExtruderMovement(toolHead.key, 0, 60, 200, 0, 0).then(({ response }) => {
                        if (response.result !== 0) {
                            this.socket && this.socket.emit('connection:loadFilament');
                        }
                    });
                }
            } else {
                this.socket && this.socket.emit(this.filamentActionType === LOAD_FIMAMENT ? 'connection:loadFilament' : 'connection:unloadFilament');
            }
        });
        this.sacpClient.handlerExtruderMovementReturn(() => {
            this.filamentAction = false;
            this.socket && this.socket.emit(this.filamentActionType === LOAD_FIMAMENT ? 'connection:loadFilament' : 'connection:unloadFilament');
        });
        this.sacpClient.handlerExtruderZOffsetReturn((data) => {
            log.info(`extruderZOffsetReturn, ${data}`);
        });
        this.sacpClient.handlerStartPrintReturn((data) => {
            log.info(`handlerStartPrintReturn, ${data}`);
        });
        this.sacpClient.handlerStopPrintReturn((data) => {
            log.info(`handlerStopPrintReturn, ${data}`);
            this.socket && this.socket.emit('connection:stopGcode', {});
        });
        this.sacpClient.handlerPausePrintReturn((data) => {
            log.info(`handlerPausePrintReturn, ${data}`);
            this.socket && this.socket.emit('connection:pauseGcode', {});
        });
        this.sacpClient.handlerResumePrintReturn((data) => {
            log.info(`handlerResumePrintreturn, ${data}`);
            this.resumeGcodeCallback && this.resumeGcodeCallback({ msg: data, code: data });
        });
    };

    public executeGcode = async (options: EventOptions, callback: () => void) => {
        log.info('run executeGcode');
        const { gcode } = options;
        const gcodeLines = gcode.split('\n');
        // callback && callback();
        log.debug(`executeGcode, ${gcodeLines}`);
        gcodeLines.forEach(_gcode => {
            this.sacpClient.executeGcode(_gcode).then(res => {
                log.info(`execute gcode: ${res}`);
            });
        });
        try {
            callback && callback();
            this.socket && this.socket.emit('connection:executeGcode', { msg: '', res: null });
        } catch (e) {
            log.error(`execute gcode error: ${e}`);
        }
    };

    public goHome = async (headType?: string) => {
        log.info('onClick gohome');
        await this.sacpClient.updateCoordinate(CoordinateType.MACHINE).then(res => {
            log.info(`Update Coordinate: ${res}`);
        });
        await this.sacpClient.requestHome().then(({ response }) => {
            log.info(`Go-Home, ${response}`);
            this.socket && this.socket.emit('serialport:read', { data: response.result === 0 ? 'OK' : 'WARNING' });
        });
        if (headType === HEAD_LASER || headType === HEAD_CNC) {
            await this.sacpClient.updateCoordinate(CoordinateType.WORKSPACE).then(res => {
                log.info(`Update Coordinate: ${res}`);
            });
        }
    };

    public coordinateMove = async ({ moveOrders, jogSpeed, headType, beforeGcodeStart = false }) => {
        log.info(`coordinate: ${JSON.stringify(moveOrders)}, ${headType}`);
        this.socket && this.socket.emit('move:status', { isMoving: true });
        const distances = [];
        const directions = [];
        moveOrders.forEach(item => {
            directions.push(COORDINATE_AXIS[item.axis]);
            distances.push(item.distance);
        });
        this.readyToWork = beforeGcodeStart;
        await this.sacpClient.requestAbsoluteCooridateMove(directions, distances, jogSpeed, CoordinateType.MACHINE).then(res => {
            log.info(`Coordinate Move: ${res.response.result}`);
            this.socket && this.socket.emit('serialport:read', { data: res.response.result === 0 ? 'CANRUNNING' : 'WARNING' });
        });
    };

    public setWorkOrigin = async ({ xPosition, yPosition, zPosition, bPosition }) => {
        log.info(`position: ${xPosition}, ${yPosition}, ${zPosition}, ${bPosition}`);
        const coordinateInfos = [new CoordinateInfo(Direction.X1, 0), new CoordinateInfo(Direction.Y1, 0), new CoordinateInfo(Direction.Z1, 0)];
        if (bPosition) {
            coordinateInfos.push(new CoordinateInfo(Direction.B1, 0));
        }
        await this.sacpClient.setWorkOrigin(coordinateInfos).then(res => {
            log.info(`Set Work Origin: ${res.data}`);
        });
        // to: only laser/cnc
    };

    public stopGcode = () => {
        this.sacpClient.stopPrint().then(res => {
            log.info(`Stop Print: ${res}`);
            // eventName && this.socket && this.socket.emit(eventName, {});
        });
    };

    public pauseGcode = () => {
        this.sacpClient.pausePrint().then(res => {
            log.info(`Pause Print: ${res}`);
            // eventName && this.socket && this.socket.emit(eventName, {});
        });
    };

    public resumeGcode = (options, callback) => {
        callback && (this.resumeGcodeCallback = callback);
        this.sacpClient.resumePrint().then(res => {
            log.info(`Resume Print: ${res}`);
            // callback && callback({ msg: res.response.result, code: res.response.result });
        });
    };

    public async switchExtruder(extruderIndex) {
        const toolhead = this.moduleInfos && this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2];
        if (!toolhead) {
            log.error(`no match toolhead 3dp, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        const key = toolhead && toolhead.key;
        const response = await this.sacpClient.SwitchExtruder(key, extruderIndex);
        log.info(`SwitchExtruder to extruderIndex:${extruderIndex}, ${JSON.stringify(response)}`);
    }

    public updateNozzleTemperature = (extruderIndex, temperature) => {
        const toolhead = this.moduleInfos && (this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2] || this.moduleInfos[SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2]);
        if (!toolhead) {
            log.error(`no match toolhead 3dp:[${toolhead}], moduleInfos:${this.moduleInfos}`,);
            return;
        }
        const key = toolhead && toolhead.key;
        this.sacpClient.SetExtruderTemperature(key, extruderIndex, temperature).then(({ response }) => {
            log.info(`SetExtruderTemperature,key:[${key}], extruderIndex:[${extruderIndex}], temperature:[${temperature}] ${JSON.stringify(response)}`);
        });
    };

    public async loadFilament(extruderIndex, eventName) {
        const toolHead = this.moduleInfos
            && (this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2] || this.moduleInfos[SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2]);
        // || this.moduleInfos[HEADT_BED_FOR_SM2]); //
        if (!toolHead) {
            log.error(`non-eixst toolHead, moduleInfos:${this.moduleInfos}`,);
            return;
        }
        if (Number(extruderIndex) === this.currentWorkNozzle) {
            this.filamentAction = true;
            this.filamentActionType = LOAD_FIMAMENT;
            this.sacpClient.ExtruderMovement(toolHead.keys, 0, 60, 200, 0, 0);
        } else {
            this.sacpClient.SwitchExtruder(toolHead.key, extruderIndex).then(({ response }) => {
                if (response.result === 0) {
                    this.filamentAction = true;
                    this.filamentActionType = LOAD_FIMAMENT;
                } else {
                    this.filamentAction = false;
                    this.socket && this.socket.emit(eventName);
                }
            });
        }
    }

    public async unloadFilament(extruderIndex, eventName) {
        const toolHead = this.moduleInfos && (this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2] || this.moduleInfos[SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2]);
        if (!toolHead) {
            log.error(`non-eixst toolHead, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        if (Number(extruderIndex) === this.currentWorkNozzle) {
            this.filamentAction = true;
            this.filamentActionType = UNLOAD_FILAMENT;
            this.sacpClient.ExtruderMovement(toolHead.keys, 0, 6, 200, 60, 150);
        } else {
            this.sacpClient.SwitchExtruder(toolHead.key, extruderIndex).then(({ response }) => {
                if (response.result === 0) {
                    this.filamentAction = true;
                    this.filamentActionType = UNLOAD_FILAMENT;
                } else {
                    this.filamentAction = false;
                    this.socket && this.socket.emit(eventName);
                }
            });
        }
        // log.info(`unloadFilament SwitchExtruder:[${extruderIndex}], ${JSON.stringify(_)}`);
        // const response = await this.sacpClient.ExtruderMovement(toolHead.key, 0, 6, 200, 60, 150);
        // this.socket && this.socket.emit(eventName);
        // log.info(`unloadFilament, ${JSON.stringify(response)}`);
    }


    public updateBedTemperature = (zoneIndex, temperature) => {
        const heatBed = this.moduleInfos && (this.moduleInfos[A400_HEADT_BED_FOR_SM2] || this.moduleInfos[HEADT_BED_FOR_SM2]); //
        if (!heatBed) {
            log.error(`non-eixst heatBed, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        this.sacpClient.setHotBedTemperature(heatBed.key, zoneIndex, temperature).then(({ response }) => {
            log.info(`updateBedTemperature, ${JSON.stringify(response)}`);
        });
    };

    public async updateNozzleOffset(extruderIndex, direction, distance) {
        const toolHead = this.moduleInfos
            && (this.moduleInfos[DUAL_EXTRUDER_TOOLHEAD_FOR_SM2] || this.moduleInfos[SINGLE_EXTRUDER_TOOLHEAD_FOR_SM2]);
        // || this.moduleInfos[HEADT_BED_FOR_SM2]); //
        if (!toolHead) {
            log.error(`non-eixst toolHead 3dp, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        log.info(`SetExtruderOffset key:${toolHead.key} extruderIndex: ${extruderIndex}, direction: ${direction}, distance:${distance}`);
        const response = await this.sacpClient.SetExtruderOffset(toolHead.key, extruderIndex, distance);
        log.info(`SetExtruderOffset, ${JSON.stringify(response)}`);
    }

    // // workspeed
    // public async getWorkSpeed(options) {
    //     const { eventName } = options;
    //     const subscribeWorkSpeedCallback = (data) => {
    //         const workSpeedInfo = new GetWorkSpeed().fromBuffer(data.response.data);
    //         log.info(`workSpeedInfo, ${workSpeedInfo}`);
    //         this.socket && this.socket.emit(eventName, { data: workSpeedInfo.feedRate });
    //     };

    //     this.sacpClient.subscribeWorkSpeed({ interval: 1000 }, subscribeWorkSpeedCallback).then((res) => {
    //         log.info(`subscribe workspeed success: ${res.code}`);
    //     });
    // }

    public async updateWorkSpeed(toolhead, workSpeed, extruderIndex = 0) {
        const headModule = this.moduleInfos && (this.moduleInfos[toolhead]); //
        if (!headModule) {
            log.error(`non-eixst toolhead[${toolhead}], moduleInfos:${JSON.stringify(this.moduleInfos)}`,);
            return;
        }

        log.info(`updateWorkSpeed headModule.key: ${headModule.key}, extruderIndex: ${extruderIndex}, workSpeed: ${workSpeed}}`);
        const leftResponse = await this.sacpClient.setWorkSpeed(headModule.key, extruderIndex, workSpeed);
        log.info(`updateWorkSpeed leftResponse, ${JSON.stringify(leftResponse)}`);


        if (isDualExtruder(toolhead)) {
            const rightResponse = await this.sacpClient.setWorkSpeed(headModule.key, 1, workSpeed);
            log.info(`updateWorkSpeed rightResponse, ${JSON.stringify(rightResponse)}`);
        }
    }


    public updateLaserPower = (value) => {
        const laserLevelTwoHead = this.moduleInfos && (this.moduleInfos[LEVEL_TWO_POWER_LASER_FOR_SM2] || this.moduleInfos[LEVEL_ONE_POWER_LASER_FOR_SM2]); //
        if (!laserLevelTwoHead) {
            log.error(`non-eixst laserLevelHead, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        this.sacpClient.SetLaserPower(laserLevelTwoHead.key, value).then(({ response }) => {
            log.info(`updateLaserPower, ${JSON.stringify(response)}`);
        });
    };

    public switchCNC = async function (headStatus) {
        const toolhead = this.moduleInfos && (this.moduleInfos[LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2] || this.moduleInfos[STANDARD_CNC_TOOLHEAD_FOR_SM2]);
        if (!toolhead) {
            log.error(`no match ${LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2} or ${STANDARD_CNC_TOOLHEAD_FOR_SM2}:1 , moduleInfos:${this.moduleInfos}`,);
            return;
        }

        // return
        const { response: responseForSpeed } = await this.sacpClient.setToolHeadSpeed(toolhead.key, this.cncTargetSpeed < 8000 ? 16000 : this.cncTargetSpeed);
        if (responseForSpeed.result === 0) {
            const { response: responseForOpen } = await this.sacpClient.switchCNC(toolhead.key, !headStatus);
            log.info(`switchCNC to [${!headStatus}], ${JSON.stringify(responseForOpen)}`);
        }
        // return response;
    };

    public updateToolHeadSpeed = (speed) => {
        const toolhead = this.moduleInfos && this.moduleInfos[LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2];
        if (!toolhead) {
            log.error(`no match ${LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2}, moduleInfos:${this.moduleInfos}`,);
            return;
        }

        this.sacpClient.setToolHeadSpeed(toolhead.key, speed).then(({ response }) => {
            log.info(`updateToolHeadSpeed Speed:[${speed}], ${JSON.stringify(response)}`);
        });
    };

    public setCncPower = (targetPower) => {
        const toolhead = this.moduleInfos && (this.moduleInfos[LEVEL_TWO_CNC_TOOLHEAD_FOR_SM2] || this.moduleInfos[STANDARD_CNC_TOOLHEAD_FOR_SM2]);
        if (!toolhead) {
            log.error(`no match cnc tool head, moduleInfos:${JSON.stringify(this.moduleInfos)}`,);
            return;
        }

        this.sacpClient.setCncPower(toolhead.key, targetPower).then(({ response }) => {
            log.info(`setCncPower setCncPower:[${targetPower}]%, ${JSON.stringify(response)}`);
        });
    };

    public async setAbsoluteWorkOrigin({ z, isRotate = false }: {
        x: number, y: number, z: number, isRotate: boolean
    }) {
        try {
            const res1 = await this.sacpClient.updateCoordinate(CoordinateType.MACHINE);
            log.debug(`updateCoordinate CoordinateType.MACHINE res: ${JSON.stringify(res1)}`);
            await this.sacpClient.getCurrentCoordinateInfo().then(async ({ coordinateSystemInfo }) => {
                const zNow = coordinateSystemInfo.coordinates.find(item => item.key === Direction.Z1).value;
                log.debug(`current positions, ${zNow}, ${z}`);
                // calculate the absolute distance on seperate axis, same reason with coordinate moving func 'coordinateMove'

                const newZ = new CoordinateInfo(Direction.Z1, isRotate ? 0 : zNow - z);
                const newCoord = [newZ];
                log.debug(`new positions, ${zNow - z}, ${JSON.stringify(newCoord)}`);
                await this.sacpClient.updateCoordinate(CoordinateType.WORKSPACE);
                const res = await this.sacpClient.setWorkOrigin(newCoord);
                log.debug(`setAbsoluteWorkOrigin res:${JSON.stringify(res)}`);
            });
        } catch (e) {
            log.error(`getLaserMaterialThickness error: ${e}`);
        }
    }

    //
    public async laserSetWorkHeight(options) {
        const { toolHead, materialThickness, isRotate } = options;
        const headModule = this.moduleInfos && (this.moduleInfos[toolHead]); //
        if (!headModule) {
            log.error(`non-eixst toolhead[${toolHead}], moduleInfos:${JSON.stringify(this.moduleInfos)}`,);
            return;
        }
        const { laserToolHeadInfo } = await this.sacpClient.getLaserToolHeadInfo(headModule.key);
        log.debug(`laserFocalLength:${laserToolHeadInfo.laserFocalLength}, materialThickness: ${materialThickness}, platformHeight:${laserToolHeadInfo.platformHeight}`);
        await this.setAbsoluteWorkOrigin({
            x: 0,
            y: 0,
            z: laserToolHeadInfo.laserFocalLength + laserToolHeadInfo.platformHeight + materialThickness,
            isRotate
        });
    }

    // set enclosure light status
    public async setEnclosureLight(options) {
        const moduleInfo = this.moduleInfos && (this.moduleInfos[ENCLOSURE_FOR_ARTISAN] || this.moduleInfos[ENCLOSURE_FOR_SM2]);
        this.sacpClient.setEnclosureLight(moduleInfo.key, options.value).then(({ response }) => {
            log.info(`Update enclosure light result, ${response.result}`);
        });
    }

    public async setEnclosureFan(options) {
        const moduleInfo = this.moduleInfos && (this.moduleInfos[ENCLOSURE_FOR_ARTISAN] || this.moduleInfos[ENCLOSURE_FOR_SM2]);
        this.sacpClient.setEnclosureFan(moduleInfo.key, options.value).then(({ response }) => {
            log.info(`Update enclosure fan result, ${response.result}`);
        });
    }

    public async setDoorDetection(options) {
        const moduleInfo = this.moduleInfos && (this.moduleInfos[ENCLOSURE_FOR_ARTISAN] || this.moduleInfos[ENCLOSURE_FOR_SM2]);
        let headTypeKey = 0;
        switch (this.headType) {
            case HEAD_PRINTING:
                headTypeKey = 0;
                break;
            case HEAD_LASER:
                headTypeKey = 1;
                break;
            case HEAD_CNC:
                headTypeKey = 2;
                break;
            default:
                break;
        }
        this.sacpClient.setEnclosureDoorEnabled(moduleInfo.key, options.enable ? 1 : 0, headTypeKey).then(({ response }) => {
            log.info(`Update enclosure door enabled: ${response.result}`);
        });
    }

    public async setFilterSwitch(options) {
        const moduleInfo = this.moduleInfos && this.moduleInfos[AIR_PURIFIER];
        options.enable && this.sacpClient.setPurifierSpeed(moduleInfo.key, options.value).then(({ response }) => {
            log.info(`Update Purifier speed, ${response.result}, ${options.value}`);
        });
        this.sacpClient.setPurifierSwitch(moduleInfo.key, options.enable).then(({ response }) => {
            log.info(`Switch Purifier update, ${response.result}`);
        });
    }

    public async setFilterWorkSpeed(options) {
        const moduleInfo = this.moduleInfos && this.moduleInfos[AIR_PURIFIER];
        this.sacpClient.setPurifierSpeed(moduleInfo.key, options.value).then(({ response }) => {
            log.info(`Update Purifier speed, ${response.result}, ${options.value}`);
        });
    }
}

export default SocketBASE;
