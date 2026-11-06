export class UIController {
    constructor() {
        this.uiPanel = document.getElementById('ui-panel');
        this.btnRotate = document.getElementById('btn-rotate');
        this.btnColor = document.getElementById('btn-color');
        this.selectModel = document.getElementById('select-model');
    }

    show() {
        this.uiPanel.style.display = 'flex';
    }

    hide() {
        this.uiPanel.style.display = 'none';
    }

    bindRotate(callback) {
        this.btnRotate.addEventListener('click', callback);
    }

    bindColor(callback) {
        this.btnColor.addEventListener('click', callback);
    }

    bindModelChange(callback) {
        this.selectModel.addEventListener('change', (e) => callback(e.target.value));
    }

    getSelectedModel() {
        return this.selectModel.value;
    }
}
