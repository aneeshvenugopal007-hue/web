// app.js - Main Application Controller combining UI, Serial, and Tracking

document.addEventListener('DOMContentLoaded', () => {
    console.clear();
    console.log('═══════════════════════════════════════════════');
    console.log('🚀 POLYGRAPH.AI - INITIALIZATION STARTED');
    console.log('═══════════════════════════════════════════════');
    console.log('✅ DOM Content Loaded');
    console.log('Global aiEngine available:', !!window.aiEngine);
    console.log('Global geminiAgent available:', !!window.geminiAgent);

    // --- DOM Elements ---
    const views = {
        setup: document.getElementById('setupView'),
        calibration: document.getElementById('calibrationView'),
        analysis: document.getElementById('analysisView'),
        results: document.getElementById('resultsView')
    };

    // Inputs
    const subjectNameInput = document.getElementById('subjectName');
    const crimeDetailsInput = document.getElementById('crimeDetails');
    const geminiApiKeyInput = document.getElementById('geminiApiKey');

    // Buttons
    const btnConnectHardware = document.getElementById('btnConnectHardware');
    const btnStartCalibration = document.getElementById('btnStartCalibration');
    const btnNextCalibration = document.getElementById('btnNextCalibration');
    const btnBeginAnalysis = document.getElementById('btnBeginAnalysis');
    const btnNextAnalysis = document.getElementById('btnNextAnalysis');
    const btnEndAnalysis = document.getElementById('btnEndAnalysis');
    const btnReset = document.getElementById('btnReset');

    // UI Feedback
    const pulseCanvas = document.getElementById('pulseCanvas');
    const bpmValue = document.getElementById('bpmValue');
    const webcamVideo = document.getElementById('webcamVideo');
    const trackingCanvas = document.getElementById('trackingCanvas');
    const hardwareStatus = document.querySelector('.hardware-status .dot');
    const cameraStatus = document.querySelector('.camera-status .dot');
    const aiStatus = document.querySelector('.ai-status .dot');

    // App State Control
    let eyeTracker = null;
    let currentCalibQuestion = 0;
    let currentAnalysisQuestion = 0;
    let analysisInterval = null;

    // store Q&A during analysis for follow-up generation
    let analysisResponses = [];
    let lastAnalysisQuestion = null;

    // Canvas contexts
    const pulseCtx = pulseCanvas.getContext('2d');
    const blinkChart = document.getElementById('blinkChart');
    const blinkCtx = blinkChart ? blinkChart.getContext('2d') : null;
    let blinkHistory = [];
    const maxBlinkHistory = 60; // seconds

    // Resize canvases
    function resizeCanvases() {
        pulseCanvas.width = pulseCanvas.parentElement.clientWidth;
        pulseCanvas.height = pulseCanvas.parentElement.clientHeight;
        if (blinkChart) {
            // set logical canvas size to match CSS size for crisp rendering
            const style = getComputedStyle(blinkChart);
            const w = parseInt(style.width, 10) || 180;
            const h = parseInt(style.height, 10) || 56;
            blinkChart.width = w * (window.devicePixelRatio || 1);
            blinkChart.height = h * (window.devicePixelRatio || 1);
            blinkChart.style.width = `${w}px`;
            blinkChart.style.height = `${h}px`;
            if (blinkCtx) blinkCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        }
    }
    window.addEventListener('resize', resizeCanvases);
    resizeCanvases();

    // --- Graph Rendering ---
    function drawPulseGraph(buffer) {
        pulseCtx.clearRect(0, 0, pulseCanvas.width, pulseCanvas.height);

        // Draw grid
        pulseCtx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
        pulseCtx.lineWidth = 1;
        pulseCtx.beginPath();
        for (let i = 0; i < pulseCanvas.height; i += 20) {
            pulseCtx.moveTo(0, i);
            pulseCtx.lineTo(pulseCanvas.width, i);
        }
        pulseCtx.stroke();

        // Draw data
        pulseCtx.strokeStyle = '#00f3ff';
        pulseCtx.lineWidth = 2;
        pulseCtx.beginPath();

        const step = pulseCanvas.width / buffer.length;

        // Find min/max to normalize
        let min = Math.min(...buffer.filter(v => v > 0));
        let max = Math.max(...buffer);
        if (min === max) { min = 0; max = 1023; } // fallback
        const range = max - min || 1;

        for (let i = 0; i < buffer.length; i++) {
            const val = buffer[i];
            const x = i * step;
            // Normalize and scale to height
            const normalized = (val - min) / range;
            const y = pulseCanvas.height - (normalized * (pulseCanvas.height - 20)) - 10;

            if (i === 0) pulseCtx.moveTo(x, y);
            else pulseCtx.lineTo(x, y);
        }
        pulseCtx.stroke();
    }

    function drawBlinkChart() {
        if (!blinkCtx || !blinkChart) return;
        // draw small line chart of recent blink/sec values
        const w = blinkChart.width / (window.devicePixelRatio || 1);
        const h = blinkChart.height / (window.devicePixelRatio || 1);
        blinkCtx.clearRect(0, 0, w, h);
        // background
        blinkCtx.fillStyle = 'rgba(0,0,0,0.12)';
        blinkCtx.fillRect(0, 0, w, h);

        const data = blinkHistory.slice(-maxBlinkHistory);
        if (data.length === 0) return;
        const maxVal = Math.max(1, ...data);
        const stepX = w / Math.max(1, data.length - 1);

        blinkCtx.strokeStyle = '#00f3ff';
        blinkCtx.lineWidth = 1.5;
        blinkCtx.beginPath();
        data.forEach((v, i) => {
            const x = i * stepX;
            const y = h - (v / maxVal) * (h - 6) - 3;
            if (i === 0) blinkCtx.moveTo(x, y);
            else blinkCtx.lineTo(x, y);
        });
        blinkCtx.stroke();

        // draw small baseline marker
        blinkCtx.fillStyle = 'rgba(255,255,255,0.6)';
        blinkCtx.font = '11px Arial';
        blinkCtx.fillText(`${data[data.length-1].toFixed(1)} b/s`, 6, 12);
    }

    // --- Hardware Events ---
    window.customSerial.onConnect(() => {
        hardwareStatus.className = 'dot green';
        hardwareStatus.parentElement.dataset.tooltip = 'Arduino Connected (COM Port)';
        btnConnectHardware.textContent = "[CONNECTED]";
        btnConnectHardware.classList.add('primary');
        btnConnectHardware.classList.remove('secondary');
        checkSetupReady();
    });

    window.customSerial.onDisconnect(() => {
        hardwareStatus.className = 'dot red';
        hardwareStatus.parentElement.dataset.tooltip = 'Hardware Disconnected';
        btnConnectHardware.textContent = "[+] CONNECT COM PORT";
        btnConnectHardware.classList.remove('primary');
        btnConnectHardware.classList.add('secondary');
        checkSetupReady();
    });

    window.customSerial.onData((bpm, buffer, raw) => {
        bpmValue.textContent = bpm;
        drawPulseGraph(buffer);
    });

    // --- UI Logic ---
    function switchView(viewName) {
        console.log(`🎬 Switching view to: ${viewName}`);
        Object.entries(views).forEach(([name, v]) => {
            if (v) {
                v.classList.remove('active');
                v.classList.add('hidden');
            }
        });
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
            views[viewName].classList.add('active');
            console.log(`✅ ${viewName} view is now active`);
        } else {
            console.error(`❌ View "${viewName}" not found! Available views:`, Object.keys(views));
        }
    }

    function checkSetupReady() {
        if (subjectNameInput.value.trim() !== '' &&
            crimeDetailsInput.value.trim() !== '' &&
            window.customSerial.connected) {
            btnStartCalibration.disabled = false;
        } else {
            // Enable it anyway for testing if fields are filled, even without hardware
            if (subjectNameInput.value.trim() !== '' && crimeDetailsInput.value.trim() !== '') {
                btnStartCalibration.disabled = false;
            } else {
                btnStartCalibration.disabled = true;
            }
        }
    }

    subjectNameInput.addEventListener('input', checkSetupReady);
    crimeDetailsInput.addEventListener('input', checkSetupReady);
    geminiApiKeyInput.addEventListener('input', checkSetupReady); // optional, does not affect readiness

    btnConnectHardware.addEventListener('click', async () => {
        if (!window.customSerial.connected) {
            // If the user cancels the serial prompt or browser doesn't support it,
            // fallback to mockup mode for demonstration purposes.
            try {
                if (navigator.serial) {
                    const success = await window.customSerial.connect();
                    if (!success) window.customSerial.testConnection();
                } else {
                    alert("Web Serial API not supported in this browser. Running in Simulation Mode.");
                    window.customSerial.testConnection();
                }
            } catch (e) {
                window.customSerial.testConnection();
            }
        }
    });

    btnStartCalibration.addEventListener('click', async () => {
        console.log('🔷 CALIBRATION START CLICKED');
        
        // Initialize Gemini agent if an API key is provided
        const key = geminiApiKeyInput.value.trim();
        if (key) {
            try {
                window.initializeGeminiAgent(key);
                console.log('✅ Gemini agent initialized.');
            } catch (e) {
                console.warn('❌ Failed to initialize Gemini agent:', e);
            }
        } else {
            console.log('⚠️ No Gemini API key provided - will use fallback questions');
        }

        // FIRST ensure questions are generated
        console.log('📋 Generating investigation questions...');
        try {
            await window.aiEngine.setContext(crimeDetailsInput.value, subjectNameInput.value);
            console.log('✅ Context set. Questions available:', window.aiEngine.investigationQuestions?.length || 0);
        } catch (e) {
            console.error('❌ Context initialization failed:', e);
            // Force fallback questions
            window.aiEngine.generateContextualQuestions(crimeDetailsInput.value);
            console.log('✅ Forced fallback questions. Total:', window.aiEngine.investigationQuestions.length);
        }

        // THEN switch view (this must happen before camera access)
        console.log('🎬 Switching to calibration view...');
        switchView('calibration');
        
        // Update status
        aiStatus.className = 'dot green';
        aiStatus.parentElement.dataset.tooltip = 'AI Engine Active';
        console.log('✅ AI Engine status: GREEN');

        // THEN set the first question immediately (before camera access)
        console.log('❓ Setting first calibration question...');
        const qEl = document.getElementById('calibrationQuestion');
        const firstQuestion = window.aiEngine.getQuestion(true, 0) || 'What is your full name?';
        qEl.textContent = firstQuestion;
        console.log('✅ Question set:', firstQuestion);
        updateCalibrationProgress();

        // FINALLY attempt camera access (this will prompt for permissions)
        console.log('📹 Starting webcam access...');
        if (!eyeTracker) {
            eyeTracker = new window.EyeTracker(webcamVideo, trackingCanvas);
            try {
                const camSuccess = await eyeTracker.start();
                if (camSuccess) {
                    cameraStatus.className = 'dot green';
                    cameraStatus.parentElement.dataset.tooltip = 'Webcam Active';
                    console.log('✅ Webcam started successfully');
                } else {
                    console.warn('⚠️ Webcam start returned false - may be unavailable');
                    cameraStatus.className = 'dot yellow';
                }
            } catch (e) {
                console.warn('⚠️ Webcam error (app continues without video):', e.message);
                cameraStatus.className = 'dot yellow';
            }
        }
        
        console.log('✅ CALIBRATION PHASE READY');
    });

    function updateCalibrationProgress() {
        const total = window.aiEngine.baseQuestions.length;
        const percent = ((currentCalibQuestion) / total) * 100;
        document.getElementById('calibrationProgress').style.width = `${percent}%`;
        document.getElementById('calibrationProgressText').textContent = `${Math.round(percent)}%`;

        if (currentCalibQuestion >= total) {
            btnNextCalibration.classList.add('hidden');
            btnBeginAnalysis.classList.remove('hidden');
            document.getElementById('calibrationQuestion').textContent = "BASELINE ESTABLISHED. READY FOR INVESTIGATION.";
            document.getElementById('calibrationQuestion').style.color = "var(--neon-green)";
        } else {
            document.getElementById('calibrationQuestion').textContent = window.aiEngine.getQuestion(true, currentCalibQuestion);
        }
    }

    btnNextCalibration.addEventListener('click', () => {
        currentCalibQuestion++;
        updateCalibrationProgress();
        // Force calibrate sample on button click
        window.aiEngine.calibrateBaseline(
            window.customSerial.pulseBuffer,
            window.customSerial.currentBpm,
            eyeTracker ? eyeTracker.saccadesPerSec : 0,
            eyeTracker ? eyeTracker.blinksPerSec : 0
        );
    });

    // --- Active Analysis Phase ---
    btnBeginAnalysis.addEventListener('click', async () => {
        console.log('🔴 ANALYSIS START CLICKED');
        
        // ensure context and questions are ready in case previous async setContext didn't finish
        try {
            await window.aiEngine.setContext(crimeDetailsInput.value, subjectNameInput.value);
            console.log('✅ Context verified. Investigation questions:', window.aiEngine.investigationQuestions?.length || 0);
        } catch (e) {
            console.warn('⚠️ Context refresh failure:', e);
        }

        // make sure there is at least one question
        if (!window.aiEngine.investigationQuestions || window.aiEngine.investigationQuestions.length === 0) {
            console.warn('⚠️ No investigation questions found. Generating fallback questions...');
            window.aiEngine.generateContextualQuestions(crimeDetailsInput.value);
            console.log('✅ Fallback questions generated:', window.aiEngine.investigationQuestions.length);
        }

        switchView('analysis');
        currentAnalysisQuestion = 0;
        analysisResponses = [];

        // first question either from AIEngine or fallback
        const firstQ = window.aiEngine.getQuestion(false, 0) || "No questions available. Please describe the incident more clearly.";
        lastAnalysisQuestion = firstQ;
        document.getElementById('analysisQuestion').textContent = firstQ;
        document.getElementById('answerInput').value = '';

        console.log('❓ First analysis question set:', firstQ.substring(0, 50) + '...');

        // Start realtime analysis tick loop
        startAnalysisLoop();
        console.log('✅ ANALYSIS PHASE READY');
    });

    btnNextAnalysis.addEventListener('click', async () => {
        const answerInput = document.getElementById('answerInput');
        const answer = answerInput.value.trim();

        // store previous Q&A if available
        if (lastAnalysisQuestion && answer) {
            analysisResponses.push({ question: lastAnalysisQuestion, answer });
        }
        answerInput.value = '';

        // try to generate a follow-up using Gemini agent if initialized
        if (window.geminiAgent) {
            try {
                const followUp = await window.geminiAgent.generateFollowUpQuestion(
                    crimeDetailsInput.value,
                    analysisResponses,
                    ''
                );
                if (followUp && followUp.trim() !== '') {
                    lastAnalysisQuestion = followUp;
                    document.getElementById('analysisQuestion').textContent = followUp;
                    return; // show new question, do not advance index
                }
            } catch (e) {
                console.warn('Follow-up generation failed, falling back to preset list.', e);
            }
        }

        // fallback to pre-generated investigation questions
        currentAnalysisQuestion++;
        const nextQ = window.aiEngine.getQuestion(false, currentAnalysisQuestion) || "(no further questions available)";
        if (nextQ) {
            lastAnalysisQuestion = nextQ;
            document.getElementById('analysisQuestion').textContent = nextQ;
        } else {
            // No more questions
            document.getElementById('analysisQuestion').textContent = "ALL QUESTIONS EXHAUSTED.";
            btnNextAnalysis.disabled = true;
        }
    });

    btnEndAnalysis.addEventListener('click', () => {
        clearInterval(analysisInterval);
        showResults();
    });

    function startAnalysisLoop() {
        const stressFill = document.getElementById('stressFill');
        const eyeShiftScore = document.getElementById('eyeShiftScore');
        const ptvScore = document.getElementById('ptvScore');

        analysisInterval = setInterval(() => {
            const saccades = eyeTracker ? eyeTracker.saccadesPerSec : 0;
            const blinks = eyeTracker ? eyeTracker.blinksPerSec : 0;
            const bpm = window.customSerial.currentBpm;

            const stress = window.aiEngine.analyzeRealTme(bpm, saccades, blinks);

            // update blink history
            blinkHistory.push(blinks);
            if (blinkHistory.length > maxBlinkHistory) blinkHistory.shift();
            drawBlinkChart();

            // UI Updates
            stressFill.style.width = stress + '%';
            if (stress > 70) stressFill.style.background = 'var(--neon-red)';
            else if (stress > 30) stressFill.style.background = 'var(--neon-yellow)';
            else stressFill.style.background = '#00ff00';

            // Eye text
            if (saccades > 3) {
                eyeShiftScore.textContent = "ERRATIC";
                eyeShiftScore.style.color = "var(--neon-red)";
            } else {
                eyeShiftScore.textContent = "NORMAL";
                eyeShiftScore.style.color = "var(--neon-blue)";
            }

            // Pulse text
            const diff = bpm - window.aiEngine.avgBaselinePulse;
            if (diff > 15) {
                ptvScore.textContent = "PEAK";
                ptvScore.style.color = "var(--neon-red)";
            } else {
                ptvScore.textContent = "STABLE";
                ptvScore.style.color = "var(--neon-blue)";
            }

        }, 1000);
    }

    // --- Results Phase ---
    function showResults() {
        switchView('results');
        aiStatus.className = 'dot yellow';

        const resultData = window.aiEngine.calculateFinalProbability();
        const probText = document.getElementById('finalProbability');
        const probCircle = document.getElementById('probCircle');
        const rationaleList = document.getElementById('rationaleList');

        // Animate Probability Number
        let currentProb = 0;
        const targetProb = parseFloat(resultData.probability);
        const animInterval = setInterval(() => {
            currentProb += targetProb / 40; // 40 steps
            if (currentProb >= targetProb) {
                currentProb = targetProb;
                clearInterval(animInterval);
            }
            probText.textContent = currentProb.toFixed(1);
        }, 50);

        // Set Circle
        requestAnimationFrame(() => {
            probCircle.style.strokeDasharray = `${targetProb}, 100`;
            if (targetProb > 70) probCircle.style.stroke = "var(--neon-red)";
            else if (targetProb > 40) probCircle.style.stroke = "var(--neon-yellow)";
            else probCircle.style.stroke = "#00ff00";
        });

        // Set Rationale
        rationaleList.innerHTML = '';
        resultData.reasons.forEach(r => {
            const li = document.createElement('li');
            li.textContent = r;
            rationaleList.appendChild(li);
        });
    }

    btnReset.addEventListener('click', () => {
        location.reload(); // Quickest way to safely reset all states
    });

});
