// Game state
const socket = io({ autoConnect: false }); // Wait for login
let scene, camera, renderer;
let player, playerMesh;
let myUsername = "";
window.spawnPoint = { x: 0, y: 5, z: 0 }; // Default spawn point
let mixer;
let animationsMap = new Map();
let currentActionName = 'idle';
let characterScale = 0.012; // Smaller scale
let otherPlayers = {};
const playerSpeed = 0.15;
const jumpForce = 0.4;
let velocity = new THREE.Vector3();
const gravity = 0.015;
let platforms = [];
let isLocked = false;

// Input
const keys = { w: false, a: false, s: false, d: false, " ": false, shift: false };
const mouse = new THREE.Vector2();
let pitchObject, yawObject; // Camera rig

// Camera Angles
// Camera Angles
let phi = 0.3; // Look slightly down
let theta = 0; // Horizontal

// Win State
let isWinner = false;

const clock = new THREE.Clock();

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const usernameInput = document.getElementById('username-input');
    const startBtn = document.getElementById('start-btn');

    startBtn.addEventListener('click', () => {
        const name = usernameInput.value.trim();
        if (name) {
            login(name);
        }
    });
});

function login(name) {
    console.log("Login attempt for:", name);

    // Ensure we init only once
    if (!scene) {
        console.log("Initializing game...");
        try {
            init();
            animate();
        } catch (e) {
            console.error("Init failed:", e);
            alert("Game Error: " + e.message);
        }
    }

    // Explicitly setup the joinSuccess listener BEFORE connecting
    socket.off('joinSuccess'); // Clear any old ones
    socket.on('joinSuccess', (data) => {
        console.log("JOIN SUCCESSFUL:", data);
        myUsername = data.username;
        const screen = document.getElementById('login-screen');
        if (screen) {
            screen.style.display = 'none';
        }

        // Ensure local nametag exists
        if (!myNametag) {
            myNametag = document.createElement('div');
            myNametag.className = 'nametag';
            myNametag.style.color = '#0ff';
            myNametag.innerText = myUsername;
            document.body.appendChild(myNametag);
        }
    });

    if (!socket.connected) {
        socket.connect();
    }

    // Emit join
    console.log("Emitting playerJoin for:", name);
    socket.emit('playerJoin', name);
}

// init(); // Removed auto init
// animate();

function init() {
    // 1. Scene
    scene = new THREE.Scene();
    window.scene = scene; // Debug
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 10, 2000);

    // 2. Camera Rig
    // Increased Far plane to 5000 to ensure big map is visible
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);

    // Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    document.body.appendChild(renderer.domElement);

    // Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(200, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    scene.add(dirLight);

    createEnvironment();
    createPlayer(); // Create local player immediately
    setupSocketEvents();

    // Event Listeners
    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = true;
        if (e.key === " ") keys[" "] = true;
        if (e.key === "Shift") keys.shift = true;
    });
    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
        if (e.key === " ") keys[" "] = false;
        if (e.key === "Shift") keys.shift = false;
    });
    window.addEventListener('resize', onWindowResize, false);

    // Pointer Lock
    document.body.addEventListener('click', () => {
        document.body.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
        isLocked = document.pointerLockElement === document.body;
        const instr = document.getElementById('instructions');
        if (isLocked) {
            if (instr) instr.style.display = 'none';
        } else {
            if (instr) instr.style.display = 'block';
        }
    });
    document.addEventListener('mousemove', onMouseMove, false);
}


// Camera Angles


function onMouseMove(event) {
    if (!isLocked) return;

    const sensitivity = 0.002;
    theta -= event.movementX * sensitivity;
    phi -= event.movementY * sensitivity;

    // Clamp vertical look
    // Prevent camera from going below the player (which caused the zoom/floor clip)
    const maxPolarAngle = Math.PI / 2 - 0.1;
    const minPolarAngle = 0.1; // Don't let it go below horizon (was -PI/2)
    phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, phi));
}

function createEnvironment() {
    // Clear old platforms if any (not strictly needed on reload but good for logic)
    platforms = [];

    const loader = new THREE.GLTFLoader();
    loader.load('assets/map/source/Level1ObbyParkour.glb', (gltf) => {
        const map = gltf.scene;
        map.scale.set(10, 10, 10); // Adjust scale if needed
        map.position.set(0, 0, 0);

        map.traverse((c) => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;

                // Checkpoint Identification
                // Check name first (more reliable if meshes are named in blender)
                // Or Check texture name
                if (c.name.toLowerCase().includes('checkpoint') ||
                    (c.material && c.material.map && c.material.map.name === 'checkpoint')) {
                    c.userData.isCheckpoint = true;
                    console.log(`Checkpoint initialized: ${c.name}`);
                }

                // Add to platforms for collision
                platforms.push(c);
            }
        });



        scene.add(map);

        // Spawn Point: Fixed at 0, 5, 0 (slightly elevated for safety)
        window.spawnPoint = { x: 0, y: 5, z: 0 };

        if (player) {
            player.position.set(window.spawnPoint.x, window.spawnPoint.y, window.spawnPoint.z);
            velocity.y = 0;
        }
    });

    // Light adjustments for the map
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    /*
    // PROCEDURAL GENERATION DISABLED
    const corridorLength = 200;
    ... (rest of procedural code disabled)
    */

    // Add a basic floor just in case (optional, maybe far below)
    const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, visible: false }); // Invisible safety floor
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -20;
    scene.add(floor);
    platforms.push(floor);
}

// Deprecated or used for other things
function createPlatform(x, y, z, w, h, d, color) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    platforms.push(mesh);
}

function createPlayer() {
    const loader = new THREE.FBXLoader();
    const textureLoader = new THREE.TextureLoader();

    // Load texture first
    const texture = textureLoader.load('assets/models/peopleColors.png');

    loader.load('assets/models/male_idle1_200f.FBX', (fbx) => {
        player = fbx;
        player.scale.set(characterScale, characterScale, characterScale);
        player.position.set(window.spawnPoint.x, window.spawnPoint.y, window.spawnPoint.z);

        player.traverse(c => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                if (c.material) {
                    c.material.map = texture;
                    // c.material.needsUpdate = true; // usually handled automatically
                }
            }
        });

        // Mixers
        mixer = new THREE.AnimationMixer(player);

        // Idle Animation (comes with the model)
        if (fbx.animations.length > 0) {
            const idleAction = mixer.clipAction(fbx.animations[0]);
            idleAction.play();
            animationsMap.set('idle', idleAction);
        }

        scene.add(player);
        window.player = player;

        // Load other animations
        loadAnimation(loader, 'assets/models/male_BasicWalk_30f.FBX', 'walk');
        loadAnimation(loader, 'assets/models/male_jogging_30f.FBX', 'run'); // or jog
        loadAnimation(loader, 'assets/models/male_running_20f.FBX', 'sprint');
        loadAnimation(loader, 'assets/models/male_riverdance_60f.FBX', 'dance');
        // Add others if needed: idle2, slowWalk
    });
}

function loadAnimation(loader, file, name) {
    loader.load(file, (anim) => {
        if (anim.animations.length > 0) {
            const clip = anim.animations[0];
            const action = mixer.clipAction(clip);
            animationsMap.set(name, action);
        }
    });
}

// Store mixers for other players to update animations
let otherMixers = {};

function createOtherPlayer(id, color, username) {
    // Container Group
    const container = new THREE.Group();
    container.userData.username = username || "Player";

    // 1. Nametag (Add immediately)
    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.innerText = container.userData.username;
    document.body.appendChild(tag);
    container.userData.nametagElement = tag;

    // 2. Load Model
    // Note: In a production game we'd clone a preloaded asset using SkeletonUtils. 
    // Here we just load it again for simplicity (browser caches the file).
    const loader = new THREE.FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('assets/models/peopleColors.png');

    loader.load('assets/models/male_idle1_200f.FBX', (fbx) => {
        fbx.scale.set(characterScale, characterScale, characterScale);

        // Apply texture
        fbx.traverse(c => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                if (c.material) c.material.map = texture;
            }
        });

        // Setup Animation Mixer
        const mixer = new THREE.AnimationMixer(fbx);
        otherMixers[id] = { mixer: mixer, action: null }; // store for update

        // Start Idle
        if (fbx.animations.length > 0) {
            const action = mixer.clipAction(fbx.animations[0]);
            action.play();
            otherMixers[id].action = action;
        }

        // Load Run Animation for this player
        // We'll just toggle between idle and run based on movement
        loader.load('assets/models/male_jogging_30f.FBX', (anim) => {
            if (anim.animations.length > 0) {
                const runClip = anim.animations[0];
                const runAction = mixer.clipAction(runClip);
                otherMixers[id].runAction = runAction;
                otherMixers[id].idleAction = otherMixers[id].action; // save idle
            }
        });

        container.add(fbx);

        // Optional: Add a invisible box for physics/raycasting if needed? 
        // For now the model is visual only.
    });

    return container;
}

// Local nametag
let myNametag;

function setupSocketEvents() {
    console.log("Setting up other socket events...");
    // Note: joinSuccess is now handled in login() to be safe, but we keep other listeners here

    socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id !== socket.id) {
                const info = serverPlayers[id];
                otherPlayers[id] = createOtherPlayer(id, info.color, info.username);
                otherPlayers[id].position.set(info.x, info.y, info.z);
                scene.add(otherPlayers[id]);
            }
        });
    });

    socket.on('newPlayer', (info) => {
        const p = createOtherPlayer(info.id, info.player.color, info.player.username);
        p.position.set(info.player.x, info.player.y, info.player.z);
        otherPlayers[info.id] = p;
        scene.add(p);
    });

    socket.on('playerMoved', (info) => {
        if (otherPlayers[info.id]) {
            otherPlayers[info.id].position.set(info.x, info.y, info.z);
        }
    });

    socket.on('disconnectPlayer', (id) => {
        if (otherPlayers[id]) {
            // Remove nametag
            if (otherPlayers[id].userData.nametagElement) {
                otherPlayers[id].userData.nametagElement.remove();
            }
            scene.remove(otherPlayers[id]);
            delete otherPlayers[id];
            if (otherMixers[id]) delete otherMixers[id];
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);



    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);

    if (player) {
        updatePhysics(delta);
        updateCamera();
        // Simple animation state logic
        updateAnimations();
        updateAnimations();
        updateNametags();
    }

    // Update other players animations
    updateOtherPlayers(delta);

    renderer.render(scene, camera);
}

function updateOtherPlayers(delta) {
    for (let id in otherPlayers) {
        const p = otherPlayers[id];

        // Interpolate position/rotation if we wanted smooth netcode
        // For now just update mixer

        if (otherMixers[id] && otherMixers[id].mixer) {
            otherMixers[id].mixer.update(delta);

            // Simple Movement Check for Animation
            // We need previous position to calculate speed
            if (!p.userData.lastPos) p.userData.lastPos = p.position.clone();

            const dist = p.position.distanceTo(p.userData.lastPos);
            const speed = dist / delta; // units per second approx

            if (otherMixers[id].runAction && otherMixers[id].idleAction) {
                if (dist > 0.01) { // Moving
                    if (otherMixers[id].current !== 'run') {
                        otherMixers[id].idleAction.fadeOut(0.2);
                        otherMixers[id].runAction.reset().fadeIn(0.2).play();
                        otherMixers[id].current = 'run';
                    }

                    // Face direction
                    const dx = p.position.x - p.userData.lastPos.x;
                    const dz = p.position.z - p.userData.lastPos.z;
                    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
                        // Smooth rotate could go here too
                        p.rotation.y = Math.atan2(dx, dz);
                    }

                } else { // Idle
                    if (otherMixers[id].current !== 'idle') {
                        otherMixers[id].runAction.fadeOut(0.2);
                        otherMixers[id].idleAction.reset().fadeIn(0.2).play();
                        otherMixers[id].current = 'idle';
                    }
                }
            }

            p.userData.lastPos.copy(p.position);
        }
    }

}

function updateAnimations() {
    if (!mixer || !animationsMap.size) return;

    let action = 'idle';

    if (isWinner) {
        action = 'dance';
    } else {
        // Speed modifiers
        const moveIncrement = keys.shift ? 0.3 : 0.15; // Sprint speed
        // ... logic for speed is elsewhere, just updating animation here

        // Check movement
        // Calculate horizontal speed
        let vx = (keys.a ? -1 : 0) + (keys.d ? 1 : 0);
        let vz = (keys.w ? -1 : 0) + (keys.s ? 1 : 0);
        const isMoving = vx !== 0 || vz !== 0; // Simple check, actual physics velocity is better but input is immediate response

        // Better: use keys to determine state
        if (keys.w || keys.a || keys.s || keys.d) {
            action = keys.shift ? 'run' : 'walk';
        }

        // Jump/Fall override
        if (!isGrounded() && velocity.y < 0) {
            // We don't have a fall animation, but we can pause the walk/run or switch to idle?
            // For now let's keep it simple. Maybe 'idle' looks better falling than walking?
            // action = 'idle'; 
        }

        // Basic state machine
        if (currentActionName !== action) {
            const prev = animationsMap.get(currentActionName);
            const next = animationsMap.get(action);

            if (prev) prev.fadeOut(0.2);
            if (next) {
                next.reset().fadeIn(0.2).play();
                currentActionName = action;
            }
        }
    }
}

function updateCamera() {
    // Camera Orbit Position
    const dist = 3.5; // Much closer

    const headHeight = 1.8; // Look at head/upper body
    // Actually our model 0,0,0 is at feet.
    // If we scale model, 0,5,0 is initial position.

    // Convert spherical to cartesian relative to player
    const cx = player.position.x + dist * Math.sin(theta) * Math.cos(phi);
    const cy = player.position.y + headHeight + dist * Math.sin(phi);
    const cz = player.position.z + dist * Math.cos(theta) * Math.cos(phi);

    // Simple ground check for camera
    // let camY = Math.max(cy, player.position.y + 1);

    camera.position.set(cx, cy, cz);

    // LOOK AT HEAD
    // Player height is roughly 1.8m * scale? No, FBX units are weird.
    // Let's target Y + some offset
    camera.lookAt(player.position.x, player.position.y + 3.0, player.position.z);
}

// Bounding Box Physics helpers
function getBox(mesh) {
    return new THREE.Box3().setFromObject(mesh);
}

function updatePhysics(delta) {
    if (isWinner) return;

    // 1. Gravity
    velocity.y -= gravity;

    // 2. Input Handling (Movement relative to Camera Look)
    let moveSpeed = playerSpeed;
    // theta is the horizontal angle. 0 is ? usually Z? 
    // sin(theta), cos(theta) mapping needs to match camera.
    // In updateCamera: x = sin(theta), z = cos(theta). SOH CAH TOA
    // so forward vector is roughly towards center = -camera vector
    // Forward from camera pov = ( -sin(theta), 0, -cos(theta) )

    let sin = Math.sin(theta);
    let cos = Math.cos(theta);

    let forwardX = -sin;
    let forwardZ = -cos;

    // Corrected Right Vector
    let rightX = cos;
    let rightZ = -sin;

    let dx = 0;
    let dz = 0;

    if (keys.w) { dx += forwardX * moveSpeed; dz += forwardZ * moveSpeed; }
    if (keys.s) { dx -= forwardX * moveSpeed; dz -= forwardZ * moveSpeed; }
    if (keys.d) { dx += rightX * moveSpeed; dz += rightZ * moveSpeed; }
    if (keys.a) { dx -= rightX * moveSpeed; dz -= rightZ * moveSpeed; }

    if (dx !== 0 || dz !== 0) {
        // Smooth Rotation
        const targetRotation = Math.atan2(dx, dz);

        // Shortest path interpolation for angle
        let diff = targetRotation - player.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const rotationSpeed = 10; // Adjust for smoothness (lower = smoother)
        player.rotation.y += diff * rotationSpeed * delta;
    }

    // Jumping
    if (keys[" "] && isGrounded()) {
        velocity.y = jumpForce;
    }

    // 3. Collision Detection & Resolution (AABB)

    // X Movement
    player.position.x += dx;
    if (checkCollisions()) {
        player.position.x -= dx; // Revert
    }

    // Z Movement
    player.position.z += dz;
    if (checkCollisions()) {
        player.position.z -= dz; // Revert
    }

    // Y Movement
    player.position.y += velocity.y;
    if (checkCollisions()) {
        // Hitting something
        player.position.y -= velocity.y;
        velocity.y = 0;
    }

    // Fallback floor
    if (player.position.y < -20) { // Lowered threshold for big map
        player.position.set(window.spawnPoint.x, window.spawnPoint.y, window.spawnPoint.z);
        velocity.y = 0;
    }

    // Network Sync (throttled slightly? nah)
    if (dx !== 0 || dz !== 0 || velocity.y !== 0) {
        socket.emit('playerMovement', {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z
        });
    }

    // Check Win
    if (window.finishZ && player.position.z > window.finishZ && !isWinner) {
        isWinner = true;
        // socket.emit('playerWin'); // Optional: tell server
    }

    // Check Checkpoints (if grounded)
    if (isGrounded()) {
        checkCheckpoints();
    }
}

function checkCheckpoints() {
    const playerBox = getBox(player);
    // Expand downwards slightly to ensure we hit the floor we are standing on
    playerBox.expandByVector(new THREE.Vector3(0, -0.5, 0));

    for (let plat of platforms) {
        if (plat.userData.isCheckpoint) {
            if (playerBox.intersectsBox(getBox(plat))) {
                // Update spawn point
                // Only update if significantly different to avoid jitter or unnecessary writes
                if (Math.abs(window.spawnPoint.x - plat.position.x) > 1 ||
                    Math.abs(window.spawnPoint.z - plat.position.z) > 1) {

                    window.spawnPoint = {
                        x: plat.position.x,
                        y: plat.position.y + 5, // Spawn slightly above
                        z: plat.position.z
                    };
                    console.log("Checkpoint reached!", window.spawnPoint);

                    // Optional: Visual feedback
                    const info = document.getElementById('info');
                    if (info) {
                        info.innerText = "Checkpoint Reached!";
                        setTimeout(() => info.innerText = "", 2000);
                    }
                }
            }
        }
    }
}

function isGrounded() {
    // Check if box lowered slightly hits anything
    // Check gravity direction (down)
    player.position.y -= 0.1;
    const hit = checkCollisions();
    player.position.y += 0.1;
    return hit && velocity.y <= 0;
}

function checkCollisions() {
    const playerBox = getBox(player);
    // Shrink slightly to facilitate sliding?
    // playerBox.expandByScalar(-0.01); 

    // 1. Platform Collisions
    for (let plat of platforms) {
        // Skip floor plane mesh itself if we use the box
        if (plat.geometry.type === 'PlaneGeometry') continue;

        if (playerBox.intersectsBox(getBox(plat))) return true;
    }

    // 2. Player Collisions
    const otherBox = new THREE.Box3();
    const pSize = new THREE.Vector3(0.6, 1.8, 0.6); // Hitbox size

    for (let id in otherPlayers) {
        const other = otherPlayers[id];
        // Create a fixed hitbox for valid gameplay (visuals animate, hitbox stays solid)
        // Note: 'other' is now a Group (container), so other.position is valid
        const center = other.position.clone();
        center.y += 0.9; // Center vertically (0 to 1.8)
        otherBox.setFromCenterAndSize(center, pSize);

        if (playerBox.intersectsBox(otherBox)) return true;
    }

    return false;
}

function updateNametags() {
    // Helper to project 3D to 2D
    const tempV = new THREE.Vector3();

    // Update Local Tag
    if (player && myNametag) {
        tempV.copy(player.position);
        tempV.y += 2.2; // Above head
        tempV.project(camera);

        const x = (tempV.x * .5 + .5) * window.innerWidth;
        const y = (tempV.y * -.5 + .5) * window.innerHeight;

        myNametag.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;

        // Simplified visibility check
        if (tempV.z < 1 && tempV.z > -1) {
            myNametag.style.display = 'block';
        } else {
            myNametag.style.display = 'none';
        }

        // Debug once in a while
        if (Math.random() < 0.01) {
            console.log("Nametag pos:", x, y, tempV.z, myNametag.style.display);
        }
    }

    // Update Others
    for (let id in otherPlayers) {
        let p = otherPlayers[id];
        let tag = p.userData.nametagElement;
        if (tag) {
            tempV.copy(p.position);
            tempV.y += 1.5; // Box height is 1, so 1.5 is good
            tempV.project(camera);

            const x = (tempV.x * .5 + .5) * window.innerWidth;
            const y = (tempV.y * -.5 + .5) * window.innerHeight;

            tag.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
            tag.style.display = (tempV.z < 1) ? 'block' : 'none';
        }
    }
}

