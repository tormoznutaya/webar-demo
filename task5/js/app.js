import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { UIController } from './UIController.js';

// --- Инициализация UI ---
const ui = new UIController();
const arButton = document.getElementById('ar-button');
const info = document.getElementById('info');

// --- Настройка сцены ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Загрузка HDRI (Environment Map) ---
const rgbeLoader = new RGBELoader();
// Путь на два уровня выше (в корень репозитория), т.к. скрипт лежит в task5/js/
rgbeLoader.load('../../hdri/studio.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture; // Применяем HDRI ко всем PBR-материалам в сцене
}, undefined, (err) => console.error('Ошибка загрузки HDRI:', err));

// --- Маркер и переменные ---
const ringGeometry = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const reticle = new THREE.Mesh(ringGeometry, ringMaterial);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
let referenceSpace = null;
let activeModels = [];      // Массив для размещенных объектов
let targetModel = null;     // Модель, на которую применяются действия (последняя поставленная)

// --- Загрузчик моделей ---
const gltfLoader = new GLTFLoader();
const modelCache = {}; // Кэш моделей, чтобы не грузить каждый раз заново

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

// Предзагрузка моделей
loadModel('../../models/model.glb').catch(console.error);
loadModel('../../models/cat.glb').catch(console.error);

// --- Логика UI (Кнопки) ---
ui.bindColor(() => {
    if (!targetModel) return;
    targetModel.traverse((child) => {
        if (child.isMesh) {
            // Меняем цвет PBR материала
            if (child.material.color) {
                child.material.color.setHex(Math.random() * 0xffffff);
            }
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
    const newModel = await loadModel(newUrl);
    newModel.position.copy(targetModel.position);
    newModel.quaternion.copy(targetModel.quaternion);
    newModel.scale.copy(targetModel.scale);
    
    scene.remove(targetModel);
    scene.add(newModel);
    targetModel = newModel;
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

    // ДОБАВЛЕНА ОПЦИЯ dom-overlay-for-handheld-ar для скрытия системных плашек
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
    ui.show(); // Показываем панель управления
    info.textContent = 'Тапните по маркеру, чтобы поставить объект';

    session.addEventListener('select', async () => {
        if (reticle.visible) {
            // Загружаем модель по умолчанию
            const selectedUrl = document.getElementById('select-model').value;
            const model = await loadModel(selectedUrl);
            
            // Делаем её меньше (подгонка под сцену)
            model.scale.set(0.3, 0.3, 0.3);
            
            model.position.setFromMatrixPosition(reticle.matrix);
            model.quaternion.setFromRotationMatrix(reticle.matrix);
            
            scene.add(model);
            activeModels.push(model);
            targetModel = model; // Запоминаем, чтобы менять цвет/модель
        }
    });

    session.addEventListener('end', () => {
        arButton.style.display = 'block';
        ui.hide();
        hitTestSource = null;
        referenceSpace = null;
        reticle.visible = false;
        targetModel = null;
        
        // Очистка сцены от моделей
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

    // Вращение модели, если включена кнопка
    if (isRotating && targetModel) {
        targetModel.rotation.y += rotationSpeed;
    }

    renderer.render(scene, camera);
});
