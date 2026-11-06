import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { UIController } from './UIController.js';

const ui = new UIController();
const arButton = document.getElementById('ar-button');
const info = document.getElementById('info');
const errorLog = document.getElementById('error-log');

function showError(msg) {
    console.error(msg);
    errorLog.style.display = 'block';
    errorLog.textContent = msg;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Вычисление базового URL для GitHub Pages
const pathParts = window.location.pathname.split('/');
let baseUrl = '';
if (pathParts.length > 1 && pathParts[1] !== '' && !window.location.hostname.includes('localhost')) {
    baseUrl = '/' + pathParts[1]; 
}

// СЛОВАРЬ МОДЕЛЕЙ (id: путь, масштаб)
// Меняйте scale, если модель слишком большая или маленькая!
const MODELS = {
    '1': { path: baseUrl + '/models/model.glb', scale: 0.3 },
    '2': { path: baseUrl + '/models/cat.glb', scale: 0.3 },
    '3': { path: baseUrl + '/models/catbox.glb', scale: 0.3 },
    '4': { path: baseUrl + '/models/toothless.glb', scale: 0.3 },
    '5': { path: baseUrl + '/models/noodle.glb', scale: 0.3 }
};

const HDRI_PATH = baseUrl + '/hdri/studio.hdr';

const rgbeLoader = new RGBELoader();
rgbeLoader.load(HDRI_PATH, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
}, undefined, () => showError('Ошибка загрузки HDRI'));

const ringGeometry = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const reticle = new THREE.Mesh(ringGeometry, ringMaterial);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
let referenceSpace = null;
let activeModels = [];
let targetModel = null; 
let blockSpawn = false; 

const gltfLoader = new GLTFLoader();
const modelCache = {};

function loadModel(url) {
    return new Promise((resolve, reject) => {
        if (modelCache[url]) {
            resolve(modelCache[url].clone(true));
            return;
        }
        gltfLoader.load(url, (gltf) => {
            modelCache[url] = gltf.scene;
            resolve(gltf.scene.clone(true));
        }, undefined, reject);
    });
}

// --- Логика UI ---
let isRotating = false;
ui.bindRotate(() => {
    blockSpawn = true; setTimeout(() => blockSpawn = false, 500);
    isRotating = !isRotating;
    document.getElementById('btn-rotate').style.background = isRotating ? '#ea4335' : '#4285f4';
});

ui.bindColor(() => {
    blockSpawn = true; setTimeout(() => blockSpawn = false, 500);
    if (!targetModel) {
        info.textContent = 'Сначала тапните по экрану, чтобы поставить модель';
        return;
    }
    targetModel.traverse((child) => {
        if (child.isMesh && child.material.color) {
            child.material.color.setHex(Math.random() * 0xffffff);
        }
    });
});

ui.bindModelChange(async (newValue) => {
    blockSpawn = true; setTimeout(() => blockSpawn = false, 500);
    if (!targetModel) {
        info.textContent = 'Сначала тапните по экрану, чтобы поставить модель';
        return;
    }

    const modelData = MODELS[newValue];
    if (!modelData) return;

    const fullUrl = modelData.path;
    const newScale = modelData.scale;

    const oldPos = targetModel.position.clone();
    const oldQuat = targetModel.quaternion.clone();

    try {
        const newModel = await loadModel(fullUrl);
        newModel.position.copy(oldPos);
        newModel.quaternion.copy(oldQuat);
        
        // Применяем масштаб из словаря
        newModel.scale.set(newScale, newScale, newScale);

        scene.remove(targetModel);
        const index = activeModels.indexOf(targetModel);
        if (index > -1) activeModels.splice(index, 1);

        scene.add(newModel);
        activeModels.push(newModel);
        targetModel = newModel; 
    } catch(e) {
        showError('Ошибка смены модели: ' + fullUrl);
    }
});

// --- WebXR ---
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
        if (supported) {
            arButton.textContent = 'Начать AR';
            arButton.disabled = false;
        } else {
            arButton.textContent = 'AR не поддерживается';
        }
    });
}

arButton.addEventListener('click', async () => {
    if (!navigator.xr) return;

    const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'dom-overlay-for-handheld-ar'],
        domOverlay: { root: document.body }
    });

    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);

    referenceSpace = await session.requestReferenceSpace('local');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    arButton.style.display = 'none';
    ui.show();
    info.textContent = 'Тапните по маркеру, чтобы поставить объект';

    session.addEventListener('select', async () => {
        if (blockSpawn) return; 
        if (!reticle.visible) return;

        try {
            const selectedValue = ui.getSelectedModel();
            const modelData = MODELS[selectedValue];
            if (!modelData) return;

            const model = await loadModel(modelData.path);
            
            // Применяем масштаб из словаря при первичном спавне
            model.scale.set(modelData.scale, modelData.scale, modelData.scale); 
            
            model.position.setFromMatrixPosition(reticle.matrix);
            model.quaternion.setFromRotationMatrix(reticle.matrix);
            
            scene.add(model);
            activeModels.push(model);
            targetModel = model;
            
            info.textContent = 'Модель установлена!';
        } catch (e) {
            showError('Не удалось загрузить модель');
        }
    });

    session.addEventListener('end', () => {
        arButton.style.display = 'block';
        ui.hide();
        hitTestSource = null;
        referenceSpace = null;
        reticle.visible = false;
        targetModel = null;
        isRotating = false;
        document.getElementById('btn-rotate').style.background = '#4285f4';
        
        activeModels.forEach(m => scene.remove(m));
        activeModels = [];
    });
});

// --- Цикл рендеринга ---
renderer.setAnimationLoop((timestamp, frame) => {
    if (!frame) return;

    if (referenceSpace) {
        const pose = frame.getViewerPose(referenceSpace);
        if (pose) {
            const view = pose.views[0];
            camera.matrix.fromArray(view.transform.matrix);
            camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
        }
    }

    if (hitTestSource) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace);
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
        } else {
            reticle.visible = false;
        }
    }

    if (isRotating && targetModel) {
        targetModel.rotation.y += 0.02;
    }

    renderer.render(scene, camera);
});
