import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { UIController } from './UIController.js';

// --- Инициализация UI и логов ---
const ui = new UIController();
const arButton = document.getElementById('ar-button');
const info = document.getElementById('info');
const errorLog = document.getElementById('error-log');

function showError(msg) {
    console.error(msg);
    errorLog.style.display = 'block';
    errorLog.textContent = msg;
}

// --- Настройка сцены ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Загрузка HDRI ---
const rgbeLoader = new RGBELoader();
rgbeLoader.load('../hdri/studio.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
}, undefined, (err) => {
    showError('Ошибка загрузки HDRI (проверьте путь к studio.hdr)');
});

// --- Маркер и переменные ---
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

// --- Загрузчик моделей ---
const gltfLoader = new GLTFLoader();
const modelCache = {};

// Обратите внимание: пути к моделям теперь БЕЗ ../../ 
// Файл лежит в task5/js/, а сервер раздает всё от корня. 
// Но чтобы не путаться, мы используем абсолютный путь от корня репозитория:
const MODEL_PATH_1 = '/models/model.glb';
const MODEL_PATH_2 = '/models/cat.glb';

function loadModel(url) {
    return new Promise((resolve, reject) => {
        if (modelCache[url]) {
            resolve(modelCache[url].clone(true));
            return;
        }
        gltfLoader.load(url, (gltf) => {
            modelCache[url] = gltf.scene;
            resolve(gltf.scene.clone(true));
        }, undefined, (err) => {
            showError('Не удалось загрузить модель: ' + url);
            reject(err);
        });
    });
}

// --- Логика UI ---
ui.bindColor(() => {
    if (!targetModel) return;
    targetModel.traverse((child) => {
        if (child.isMesh && child.material.color) {
            child.material.color.setHex(Math.random() * 0xffffff);
        }
    });
});

let isRotating = false;
let rotationSpeed = 0;
ui.bindRotate(() => {
    isRotating = !isRotating;
    rotationSpeed = isRotating ? 0.02 : 0;
});

ui.bindModelChange(async (newUrl) => {
    if (!targetModel) return;
    // Меняем путь на абсолютный
    const fullUrl = newUrl.includes('model.glb') ? MODEL_PATH_1 : MODEL_PATH_2;
    try {
        const newModel = await loadModel(fullUrl);
        newModel.position.copy(targetModel.position);
        newModel.quaternion.copy(targetModel.quaternion);
        newModel.scale.copy(targetModel.scale);
        
        scene.remove(targetModel);
        scene.add(newModel);
        targetModel = newModel;
    } catch(e) {}
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
        console.log("Произошел тап (select)!");
        
        if (!reticle.visible) {
            console.log("Тап проигнорирован: маркер (reticle) не виден");
            return;
        }

        // Загружаем модель по умолчанию (первую)
        try {
            const model = await loadModel(MODEL_PATH_1);
            model.scale.set(0.3, 0.3, 0.3);
            
            model.position.setFromMatrixPosition(reticle.matrix);
            model.quaternion.setFromRotationMatrix(reticle.matrix);
            
            scene.add(model);
            activeModels.push(model);
            targetModel = model;
            
            console.log("Модель успешно добавлена!");
            info.textContent = 'Модель установлена!';
        } catch (e) {
            console.log("Ошибка при загрузке модели во время тапа", e);
        }
    });

    session.addEventListener('end', () => {
        arButton.style.display = 'block';
        ui.hide();
        hitTestSource = null;
        referenceSpace = null;
        reticle.visible = false;
        targetModel = null;
        
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
        targetModel.rotation.y += rotationSpeed;
    }

    renderer.render(scene, camera);
});
