import i18n from '../i18n';

export const STEP_STAGE = {
    EMPTY: 0,

    // laser and cnc
    CNC_LASER_GENERATING_TOOLPATH: 1,
    CNC_LASER_GENERATE_TOOLPATH_SUCCESS: 2,
    CNC_LASER_GENERATE_TOOLPATH_FAILED: 3,
    CNC_LASER_PREVIEWING: 4,
    CNC_LASER_PREVIEW_SUCCESS: 5,
    CNC_LASER_PREVIEW_FAILED: 6,
    CNC_LASER_RE_PREVIEW: 7,
    CNC_LASER_GENERATING_GCODE: 8,
    CNC_LASER_GENERATE_GCODE_SUCCESS: 9,
    CNC_LASER_GENERATE_GCODE_FAILED: 10,
    CNC_LASER_UPLOADING_IMAGE: 11,
    CNC_LASER_UPLOAD_IMAGE_SUCCESS: 12,
    CNC_LASER_UPLOAD_IMAGE_FAILED: 13,
    CNC_LASER_PROCESSING_IMAGE: 14,
    CNC_LASER_PROCESS_IMAGE_SUCCESS: 15,
    CNC_LASER_PROCESS_IMAGE_FAILED: 16,
    CNC_LASER_GENERATING_VIEWPATH: 17,
    CNC_LASER_GENERATE_VIEWPATH_SUCCESS: 18,
    CNC_LASER_GENERATE_VIEWPATH_FAILED: 19,
    CNC_LASER_RENDER_TOOLPATH: 20,
    CNC_LASER_GENERATE_TOOLPATH_AND_PREVIEW: 21,
    CNC_LASER_RENDER_VIEWPATH: 22,
    CNC_LASER_REPAIRING_MODEL: 23,

    // laser
    LASER_CUTTING_STL: 34,
    LASER_CUT_STL_SUCCEED: 35,
    LASER_CUT_STL_FAILED: 36,

    // printing
    PRINTING_LOADING_MODEL: 23,
    PRINTING_LOAD_MODEL_COMPLETE: 24,
    PRINTING_LOAD_MODEL_FAILED: 25,
    PRINTING_SLICE_PREPARING: 26,
    PRINTING_SLICING: 27,
    PRINTING_SLICE_SUCCEED: 28,
    PRINTING_SLICE_FAILED: 29,
    PRINTING_PREVIEWING: 30,
    PRINTING_PREVIEW_SUCCEED: 31,
    PRINTING_PREVIEW_FAILED: 32,
    PRINTING_ROTATE_ANALYZE: 33,
    PRINTING_GENERATE_SUPPORT_AREA: 37,
    PRINTING_GENERATE_SUPPORT_MODEL: 38,
    PRINTING_GENERATE_SUPPORT_FAILED: 39,
    PRINTING_ARRANGE_MODELS_SUCCESS: 40,
    PRINTING_ARRANGE_MODELS_FAILED: 41,
    PRINTING_ARRANGING_MODELS: 42,
    PRINTING_AUTO_ROTATING_MODELS: 43,
    PRINTING_AUTO_ROTATE_SUCCESSED: 44,
    PRINTING_SCALE_TO_FIT_WITH_ROTATE: 45,
    PRINTING_SCALE_TO_FIT_WITH_ROTATE_SUCCESS: 46,
    PRINTING_SCALE_TO_FIT_WITH_ROTATE_FAILED: 47,
    PRINTING_SIMPLIFY_MODEL: 48,
    PRINTING_SIMPLIFY_MODEL_SUCCESS: 49,
    PRINTING_SIMPLIFY_MODEL_FAILED: 50,
    PRINTING_REPAIRING_MODEL: 51
};

export const PROCESS_STAGE = {
    EMPTY: 0,

    // cnc laser
    CNC_LASER_GENERATE_TOOLPATH_AND_PREVIEW: 1,
    CNC_LASER_UPLOAD_IMAGE: 2, // upload and process
    CNC_LASER_PROCESS_IMAGE: 3,
    CNC_LASER_VIEW_PATH: 4, // simulation

    // laser
    LASER_CUT_STL: 8, // cut stl

    // printing
    PRINTING_LOAD_MODEL: 5,
    PRINTING_SLICE_AND_PREVIEW: 6,
    PRINTING_ROTATE_ANALYZE: 7,
    PRINTING_GENERATE_SUPPORT: 9,
    PRINTING_ARRANGE_MODELS: 10,
    PRINTING_AUTO_ROTATE: 11,
    PRINTING_SCALE_TO_FIT_WITH_ROTATE: 12,
    PRINTING_SIMPLIFY_MODEL: 13,
    PRINTING_REPAIRING_MODEL: 14,
    PRINTING_SPLIT_MODEL: 1015,
};

const _STATE = {
    EMPTY: 0,
    RUNNING: 1,
    SUCCESS: 2,
    FAILED: 3
};

const EPSILON = 1e-6;

class ProgressState {
    constructor(stages, notice = '', successNotice = '', failedNotice = '') {
        this.stages = stages;
        for (let index = 0; index < stages.length; index++) {
            this.stages[index].startPercent = (index === 0 ? 0 : this.stages[index - 1].percent);
        }
        this.notice = notice;
        this.successNotice = successNotice;
        this.failedNotice = failedNotice;
    }

    getNewProgress(stageID, progress, count = 1, totalCount = 1) {
        const stage = this.stages.find(s => s.stageID === stageID);
        return stage.startPercent + (stage.percent - stage.startPercent) * (count - 1) / totalCount + progress * (stage.percent - stage.startPercent) / totalCount;
    }

    getNotice(state, stageID, progress) {
        switch (state) {
            case _STATE.RUNNING:
                return i18n._(this.notice, { progress: (progress * 100.0).toFixed(1) });
            case _STATE.SUCCESS:
                return i18n._(this.successNotice);
            case _STATE.FAILED:
                return i18n._(this.failedNotice);
            default:
                return i18n._(this.notice, { progress: (progress * 100.0).toFixed(1) });
        }
    }
}

class ProgressStatesManager {
    constructor() {
        this.reset();
        this._init();
    }

    _init() {
        this.progressStates = {};
        this.stagesProcessStageID = {};

        // cnc & laser
        this.push(PROCESS_STAGE.CNC_LASER_GENERATE_TOOLPATH_AND_PREVIEW,
            [
                {
                    stageID: STEP_STAGE.CNC_LASER_GENERATING_TOOLPATH,
                    percent: 0.4
                },
                {
                    stageID: STEP_STAGE.CNC_LASER_RENDER_TOOLPATH,
                    percent: 0.8
                },
                {
                    stageID: STEP_STAGE.CNC_LASER_GENERATING_GCODE,
                    percent: 1
                }
            ],
            'key-Progress/LaserCNC-Generate toolpath and preview: {{progress}}%',
            'key-Progress/LaserCNC-Generated toolpath and previewed successfully.',
            'key-Progress/LaserCNC-Failed to generate toolpath and preview.');
        this.push(PROCESS_STAGE.CNC_LASER_UPLOAD_IMAGE,
            [
                {
                    stageID: STEP_STAGE.CNC_LASER_UPLOADING_IMAGE,
                    percent: 0.5
                },
                {
                    stageID: STEP_STAGE.CNC_LASER_PROCESSING_IMAGE,
                    percent: 1
                }
            ],
            'key-Progress/LaserCNC-Loading object {{progress}}%',
            'key-Progress/LaserCNC-Loaded object successfully.',
            'key-Progress/LaserCNC-Failed to load object.');
        this.push(PROCESS_STAGE.CNC_LASER_PROCESS_IMAGE,
            [
                {
                    stageID: STEP_STAGE.CNC_LASER_PROCESSING_IMAGE,
                    percent: 1
                }
            ],
            'key-Progress/LaserCNC-Processing object {{progress}}%',
            'key-Progress/LaserCNC-Processed object successfully.',
            'key-Progress/LaserCNC-Failed to process object.');
        this.push(PROCESS_STAGE.CNC_LASER_VIEW_PATH,
            [
                {
                    stageID: STEP_STAGE.CNC_LASER_GENERATING_VIEWPATH,
                    percent: 0.9
                },
                {
                    stageID: STEP_STAGE.CNC_LASER_RENDER_VIEWPATH,
                    percent: 1
                }
            ],
            'key-Progress/LaserCNC-Generating simulation {{progress}}%',
            'key-Progress/LaserCNC-Generated simulation successfully.',
            'key-Progress/LaserCNC-Failed to generate simulation.');

        // Laser
        this.push(PROCESS_STAGE.LASER_CUT_STL,
            [
                {
                    stageID: STEP_STAGE.LASER_CUTTING_STL,
                    percent: 1
                }
            ],
            'key-Progress/Laser-Loading model...',
            'key-Progress/Laser-Loaded model successfully.',
            'key-Progress/Laser-Failed to load model.');

        // Printing
        this.push(PROCESS_STAGE.PRINTING_LOAD_MODEL,
            [
                {
                    stageID: STEP_STAGE.PRINTING_LOADING_MODEL,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Loading model...{{progress}}%',
            'key-Progress/3DP-Loaded model successfully.',
            'key-Progress/3DP-Failed to load model.');
        this.push(PROCESS_STAGE.PRINTING_SLICE_AND_PREVIEW,
            [
                {
                    stageID: STEP_STAGE.PRINTING_SLICING,
                    percent: 0.5
                },
                {
                    stageID: STEP_STAGE.PRINTING_PREVIEWING,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Previewing G-code...{{progress}}%',
            'key-Progress/3DP-Previewed G-code successfully.',
            'key-Progress/3DP-Failed to preview G-code.');
        this.push(PROCESS_STAGE.PRINTING_ROTATE_ANALYZE,
            [
                {
                    stageID: STEP_STAGE.PRINTING_ROTATE_ANALYZE,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Calculating Rotation',
            'key-Progress/3DP-Calculated Rotation successfully.',
            'key-Progress/3DP-Failed to calculate Rotation.');
        this.push(PROCESS_STAGE.PRINTING_GENERATE_SUPPORT,
            [
                {
                    stageID: STEP_STAGE.PRINTING_GENERATE_SUPPORT_AREA,
                    percent: 0.5
                },
                {
                    stageID: STEP_STAGE.PRINTING_GENERATE_SUPPORT_MODEL,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Generating support... {{progress}}%',
            'key-Progress/3DP-Generated support successfully.',
            'key-Progress/3DP-Failed to generate support.');
        this.push(PROCESS_STAGE.PRINTING_ARRANGE_MODELS,
            [
                {
                    stageID: STEP_STAGE.PRINTING_ARRANGING_MODELS,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Arranging models...{{progress}}%',
            'key-Progress/3DP-Arrange models successfully.',
            'key-Progress/3DP-Arrange models failed.');
        this.push(PROCESS_STAGE.PRINTING_AUTO_ROTATE,
            [
                {
                    stageID: STEP_STAGE.PRINTING_AUTO_ROTATING_MODELS,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Auto Rotate models...{{progress}}%',
            'key-Progress/3DP-Auto Rotate models successfully.',
            'key-Progress/3DP-Auto Rotate models failed.');
        this.push(PROCESS_STAGE.PRINTING_SCALE_TO_FIT_WITH_ROTATE,
            [
                {
                    stageID: STEP_STAGE.PRINTING_SCALE_TO_FIT_WITH_ROTATE,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Scale to fit...{{progress}}%',
            'key-Progress/3DP-Scale to fit successfully.',
            'key-Progress/3DP-Scale to fit failed.');
        this.push(PROCESS_STAGE.PRINTING_SIMPLIFY_MODEL,
            [
                {
                    stageID: STEP_STAGE.PRINTING_SIMPLIFY_MODEL,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Simplify model...{{prgress}}%',
            'key-Progress/3DP-Simplify model successfully.',
            'key-Progress/3DP-Simplify model failed.');
        this.push(
            PROCESS_STAGE.PRINTING_REPAIRING_MODEL,
            [
                {
                    stageID: STEP_STAGE.PRINTING_REPAIRING_MODEL,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Repairing model... {{progress}}%',
            'key-Progress/3DP-Repair model successfully.',
            'key-Progress/3DP-Failed to repair model.',
        );
        this.push(
            PROCESS_STAGE.PRINTING_SPLIT_MODEL,
            [
                {
                    stageID: STEP_STAGE.PRINTING_SPLIT_MODEL,
                    percent: 1
                }
            ],
            'key-Progress/3DP-Splitting model...',
            'key-Progress/3DP-Split model successfully.',
            'key-Progress/3DP-Failed to split model.'
        );
    }

    push(processStageID, stages, notice, successNotice, failedNotice) {
        if (stages[0].stageID) {
            this.stagesProcessStageID[stages[0].stageID] = processStageID;
        }
        this.progressStates[processStageID] = new ProgressState(stages, notice, successNotice, failedNotice);
    }

    getProgress(processStageID, stageID, progress, count, totalCount) {
        return this.progressStates[processStageID].getNewProgress(stageID, progress, count, totalCount);
    }

    getNotice(stageID) {
        const progress = this.progress;
        if (this.processStageID === PROCESS_STAGE.EMPTY) {
            return '';
        }
        return this.progressStates[this.processStageID].getNotice(this.state, stageID, progress);
    }

    startProgress(processStageID = PROCESS_STAGE.EMPTY, counts = []) {
        this.processStageID = processStageID;
        this.progress = 0;
        this.stage = 0;
        this.counts = counts;
        this.totalCounts = counts && [...counts];
        this.state = _STATE.RUNNING;
    }

    updateProgress(stageID, progress) {
        if (!this.processStageID && this.stagesProcessStageID[stageID]) {
            this.startProgress(this.stagesProcessStageID[stageID]);
        }
        const totalCount = this.totalCounts && this.totalCounts[this.stage];
        const count = this.counts && this.counts[this.stage];
        const newProgress = this.getProgress(this.processStageID, stageID, progress, (totalCount ?? 1) + 1 - (count ?? 1), totalCount ?? 1);
        if (newProgress >= 1 - EPSILON) {
            this.progress = 1;
        } else {
            if (newProgress > this.progress) {
                this.progress = newProgress;
            }
        }
        return this.progress;
    }

    startNextStep() {
        if (this.counts && this.counts[this.stage] && this.counts[this.stage] - 1 > 0) {
            this.counts[this.stage] -= 1;
        } else {
            this.stage += 1;
        }
    }

    finishProgress(success = true) {
        // this.reset();
        if (success) {
            this.state = _STATE.SUCCESS;
        } else {
            this.state = _STATE.FAILED;
        }
    }

    reset() {
        this.progress = 0;
        this.processStageID = PROCESS_STAGE.EMPTY;
        this.state = _STATE.EMPTY;
    }

    getProgressStage() {
        return this.processStageID;
    }

    inProgress() {
        return this.state === _STATE.RUNNING;
    }
}

export default ProgressStatesManager;
