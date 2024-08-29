// @ts-nocheck
// NAME: Waveform
// AUTHOR: SPOTLAB
// VERSION: 1.0.1
// DESCRIPTION: Waveform seekbar generated from Spotify audio analysis API.

/// <reference path='../globals.d.ts' />

(function() {
  // Debug flag
  const DEBUG = false; // Set this to true for verbose console logging
  const SIMULATE_API_ERROR = false; // Set this to true to simulate an API error

  function debug(message) {
    if (DEBUG) {
      console.log(`Waveform extension: ${message}`);
    }
  }

  function error(message) {
    console.error(`Waveform extension: ${message}`);
  }

  // Wait for Spicetify to be fully loaded
  function waitForSpicetify() {
    debug("Waiting for Spicetify to load...");
    if (!Spicetify.Player.data || !Spicetify.URI || !Spicetify.CosmosAsync) {
      setTimeout(waitForSpicetify, 300);
      return;
    }
    debug("Spicetify loaded. Initializing waveform seekbar.");
    initializeWaveformSeekbar();
  }

  function initializeWaveformSeekbar() {
    debug("Initializing WaveformSeekbar class");
    class WaveformSeekbar {
      constructor() {
        debug("WaveformSeekbar constructor called");
        this.currentTrack = null;
        this.waveformData = null;
        this.canvas = null;
        this.seekBar = null;
        this.customSeekBar = null;
        this.originalSeekBar = null;
        this.originalSeekBarParent = null;
        this.originalSeekBarNextSibling = null;
        this.waveformDrawn = false;
        this.retryAttempts = 0;
        this.maxRetryAttempts = 3;
        this.retryDelay = 2000; // 2 seconds
        this.contrastFactor = 4.0; // Higher contrast, adjust as needed
        this.loadingAnimationFrame = null;
        this.usingCustomSeekBar = false;
        this.seekheadMarker = null;
        this.seekheadTime = null;
        
        this.updateColors = this.updateColors.bind(this);
        this.handleTrackChange = this.handleTrackChange.bind(this);
        Spicetify.Player.addEventListener("appchange", this.updateColors);
        
        this.initializeExtension().catch(err => error(`Initialization error: ${err}`));
      }

      async initializeExtension() {
        debug("Initializing extension");
        this.findSeekBar();
        this.addEventListeners();
        await this.processInitialTrack();
        this.updateColors();
        debug("Extension initialization complete");
      }

      findSeekBar() {
        debug("Finding seek bar");
        this.seekBar = document.querySelector('.playback-bar');
        if (!this.seekBar) {
          error("Seek bar not found");
        } else {
          debug("Seek bar found");
        }
      }

      async processInitialTrack() {
        debug("Processing initial track");
        const initialURI = this.getCurrentURI();
        if (initialURI) {
          debug(`Initial track URI: ${initialURI}`);
          await this.showAnalysisForUri(initialURI);
        } else {
          debug("No initial track found");
        }
      }

      addEventListeners() {
        debug("Adding event listeners");
        Spicetify.Player.addEventListener("songchange", this.handleTrackChange);
        Spicetify.Player.addEventListener("onprogress", this.updatePlaybackPosition.bind(this));
      }

      handleTrackChange() {
        const newURI = this.getCurrentURI();
        if (newURI !== this.currentTrack) {
          this.showAnalysisForUri(newURI);
        }
      }

      getCurrentURI() {
        const data = Spicetify.Player.origin?.getState?.();
        const uri = data?.item?.uri || null;
        debug(`Current URI: ${uri}`);
        return uri;
      }

      async showAnalysisForUri(URI) {
        debug(`Showing analysis for URI: ${URI}`);
        if (!URI || URI === this.currentTrack) {
          debug("URI unchanged or null, skipping analysis");
          return;
        }

        this.currentTrack = URI;
        this.waveformData = null;
        this.waveformDrawn = false;
        
        if (!this.customSeekBar) {
          this.replaceSeekBar();
        } else {
          this.usingCustomSeekBar = true;
        }
        
        this.drawLoadingAnimation();  // Start the loading animation
        this.retryAttempts = 0;

        this.resetSeekheadVisibility();

        try {
          await this.fetchAudioAnalysisWithRetry(URI);
          this.drawWaveform();
        } catch (err) {
          error(`Failed to show analysis for URI: ${err.message}`);
          this.handleFetchFailure();
        }
      }

      async fetchAudioAnalysisWithRetry(trackUri) {
        debug(`Fetching audio analysis for ${trackUri}`);
        while (this.retryAttempts < this.maxRetryAttempts) {
          try {
            await this.fetchAudioAnalysis(trackUri);
            cancelAnimationFrame(this.loadingAnimationFrame);  // Stop the loading animation
            debug("Audio analysis fetched successfully");
            return;
          } catch (err) {
            error(`Failed to fetch audio analysis: ${err.message}`);
            this.retryAttempts++;
            if (this.retryAttempts < this.maxRetryAttempts) {
              debug(`Retrying in ${this.retryDelay}ms (attempt ${this.retryAttempts}/${this.maxRetryAttempts})`);
              await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
          }
        }
        error("Max retry attempts reached. Using original seekbar.");
        throw new Error("Failed to fetch audio analysis after max retries");
      }

      async fetchAudioAnalysis(trackUri) {
        debug(`Fetching audio analysis from Spotify API for ${trackUri}`);
        if (!trackUri) {
          throw new Error("Invalid track URI");
        }

        if (SIMULATE_API_ERROR) {
          debug("Simulating API error");
          throw new Error("Simulated API error: 404 Not Found");
        }

        const trackId = trackUri.split(':').pop();
        const response = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/audio-analysis/${trackId}`);
        debug("Audio analysis data received, processing...");
        this.waveformData = this.processAudioAnalysis(response);
      }

      processAudioAnalysis(analysisData) {
        debug("Processing audio analysis data");
        if (!analysisData || !analysisData.segments || !analysisData.track) {
          throw new Error("Invalid audio analysis data");
        }

        const segments = analysisData.segments;
        const duration = analysisData.track.duration;
        
        const dataPoints = 1000;
        const segmentDuration = duration / dataPoints;
        
        let processedData = new Array(dataPoints).fill(0);
        
        segments.forEach(segment => {
          const startIndex = Math.floor(segment.start / segmentDuration);
          const endIndex = Math.min(Math.floor((segment.start + segment.duration) / segmentDuration), dataPoints - 1);
          
          // Normalize loudness to a value between 0 and 1
          const normalizedLoudness = 1 - (Math.min(Math.max(segment.loudness_max, -40), 0) / -40);
          
          // Apply contrast adjustment
          const adjustedLoudness = Math.pow(normalizedLoudness, this.contrastFactor);
          
          for (let i = startIndex; i <= endIndex; i++) {
            processedData[i] = Math.max(processedData[i], adjustedLoudness);
          }
        });
        
        debug("Audio analysis processing complete");
        return processedData;
      }

      replaceSeekBar() {
        debug("Replacing seek bar with custom waveform");
        if (!this.seekBar) {
          error("Seek bar element not found");
          return;
        }

        // Store the original seekbar
        this.originalSeekBar = this.seekBar;
        this.originalSeekBarParent = this.seekBar.parentNode;
        this.originalSeekBarNextSibling = this.seekBar.nextSibling;

        // Create our custom seekbar
        this.customSeekBar = document.createElement('div');
        this.customSeekBar.style.width = '100%';
        this.customSeekBar.style.height = '30px';
        this.customSeekBar.style.position = 'relative';

        this.canvas = document.createElement('canvas');
        this.canvas.style.width = 'calc(100% - 80px)'; // Add 40px padding on each side
        this.canvas.style.height = '100%';
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = '40px';
        this.canvas.style.top = '0';
        this.customSeekBar.appendChild(this.canvas);

        // Create containers for timestamps
        this.currentTimeLabel = document.createElement('div');
        this.totalTimeLabel = document.createElement('div');

        // Style the containers
        const timeStyle = `
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-family,CircularSp,CircularSp-Arab,CircularSp-Hebr,CircularSp-Cyrl,CircularSp-Grek,CircularSp-Deva,var(--fallback-fonts,sans-serif));
          font-weight: var(--font-weight-normal, 400);
          font-size: var(--font-size-x-small, 11px);
          color: var(--text-subdued,#6a6a6a);
          letter-spacing: 0.1em;
          padding: 2px 5px;
        `;
        this.currentTimeLabel.style.cssText = timeStyle + 'left: 0;';
        this.totalTimeLabel.style.cssText = timeStyle + 'right: 0;';

        // Add the containers to the custom seekbar
        this.customSeekBar.appendChild(this.currentTimeLabel);
        this.customSeekBar.appendChild(this.totalTimeLabel);

        // Create seekhead marker
        this.seekheadMarker = document.createElement('div');
        this.seekheadMarker.style.cssText = `
          position: absolute;
          top: 0;
          width: 2px;
          height: 100%;
          background-color: var(--spice-subtext);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.1s ease;
          z-index: 10;
        `;
        this.customSeekBar.appendChild(this.seekheadMarker);

        // Create a separate element for the time display
        this.seekheadTime = document.createElement('div');
        this.seekheadTime.style.cssText = `
          position: absolute;
          top: -20px;
          transform: translateX(-50%);
          background-color: rgba(var(--spice-rgb-main), 0.7);
          color: var(--spice-subtext);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 10px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.1s ease;
          z-index: 11;
        `;
        this.customSeekBar.appendChild(this.seekheadTime);

        // Replace the original seekbar with our custom one
        this.originalSeekBarParent.insertBefore(this.customSeekBar, this.originalSeekBar);
        this.originalSeekBarParent.removeChild(this.originalSeekBar);

        // Set canvas dimensions
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        this.customSeekBar.addEventListener('click', this.onWaveformClick.bind(this));
        this.customSeekBar.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.customSeekBar.addEventListener('mouseenter', this.onMouseEnter.bind(this));
        this.customSeekBar.addEventListener('mouseleave', this.onMouseLeave.bind(this));

        if (!this.canvas) {
          error("Failed to create canvas");
        } else {
          debug("Canvas created successfully");
        }

        this.usingCustomSeekBar = true;
        debug("Custom seekbar is now active");
      }

      drawWaveform() {
        debug("Drawing waveform");
        if (!this.canvas) {
          error("Canvas not available");
          return;
        }
        if (!this.waveformData) {
          error("Waveform data not available");
          return;
        }

        const ctx = this.canvas.getContext('2d');
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        const backgroundColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--spice-button-disabled').trim() || '#b3b3b3';

        const barWidth = width / this.waveformData.length;

        this.waveformData.forEach((loudness, index) => {
          const x = index * barWidth;
          const barHeight = loudness * height * 0.8;
          const y = (height - barHeight) / 2;
          ctx.fillStyle = backgroundColor;
          ctx.fillRect(x, y, barWidth - 1, barHeight);
        });

        this.waveformDrawn = true;
        this.updatePlaybackPosition();
        this.resetSeekheadVisibility();
        debug("Waveform drawn successfully");
      }

      updatePlaybackPosition() {
        if (!this.usingCustomSeekBar) {
          return;  // Skip update if we're not using the custom seekbar
        }

        if (!this.canvas || !this.waveformDrawn) {
          debug("Skipping playback position update: Canvas or waveform not ready");
          return;
        }

        const duration = Spicetify.Player.getDuration();
        const currentTime = Spicetify.Player.getProgress();
        const position = currentTime / duration;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        const ctx = this.canvas.getContext('2d');
        
        const backgroundColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--spice-button-disabled').trim() || '#b3b3b3';
        
        const progressColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--spice-button').trim() || '#1DB954';
        
        const barWidth = width / this.waveformData.length;

        this.waveformData.forEach((loudness, index) => {
          const x = index * barWidth;
          const barHeight = loudness * height * 0.8;
          const y = (height - barHeight) / 2;
          
          if (x <= position * width) {
            ctx.fillStyle = progressColor;
          } else {
            ctx.fillStyle = backgroundColor;
          }
          
          ctx.fillRect(x, y, barWidth - 1, barHeight);
        });

        // Update time labels
        this.currentTimeLabel.textContent = this.formatTime(currentTime);
        this.totalTimeLabel.textContent = this.formatTime(duration);
      }

drawLoadingAnimation() {
        if (!this.canvas) {
          debug("Skipping loading animation: Canvas not available");
          return;
        }

        const ctx = this.canvas.getContext('2d');
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        const barCount = 250;
        const barWidth = width / (barCount * 2); // Leave space between bars
        const maxBarHeight = height * 2;

        const animationSpeed = 0.002;
        const time = Date.now() * animationSpeed;

        ctx.fillStyle = getComputedStyle(document.documentElement)
          .getPropertyValue('--spice-button-disabled').trim() || '#1DB954';

        for (let i = 0; i < barCount; i++) {
          const x = (i * 2 + 0.5) * barWidth; // Center each bar in its space
          
          // Create a wave-like pattern
          const waveFrequency = 0.15;
          const waveAmplitude = 0.5;
          const baseHeight = 0.1;
          
          const wave1 = Math.sin(time + i * waveFrequency) * waveAmplitude;
          const wave2 = Math.sin(time * 1.5 + i * waveFrequency * 0.5) * (waveAmplitude * 0.5);
          const wave3 = Math.sin(time * 0.5 + i * waveFrequency * 0.25) * (waveAmplitude * 0.25);
          
          const combinedWave = (wave1 + wave2 + wave3) / 3 + baseHeight;
          
          const barHeight = combinedWave * maxBarHeight;
          
          const y = (height - barHeight) / 2;
          ctx.fillRect(x, y, barWidth * 0.8, barHeight); // Slightly narrow bars for visual separation
        }

        this.loadingAnimationFrame = requestAnimationFrame(() => this.drawLoadingAnimation());
      }

      onWaveformClick(event) {
        debug("Waveform clicked");
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = x / rect.width;
        
        const seekTime = percentage * Spicetify.Player.getDuration();
        debug(`Seeking to ${seekTime}ms`);
        Spicetify.Player.seek(seekTime);
        
        setTimeout(() => {
          this.updatePlaybackPosition();
        }, 0);
      }

      onMouseMove(event) {
        const rect = this.customSeekBar.getBoundingClientRect();
        const canvasRect = this.canvas.getBoundingClientRect();
        
        // Calculate the offset of the canvas within the custom seek bar
        const canvasOffset = canvasRect.left - rect.left;
        
        // Adjust x to account for the canvas offset
        const x = event.clientX - rect.left - canvasOffset;
        
        // Ensure x is within the bounds of the canvas
        const boundedX = Math.max(0, Math.min(x, canvasRect.width));
        
        // Update seekhead marker position, adding the canvas offset back
        const markerPosition = boundedX + canvasOffset;
        this.seekheadMarker.style.left = `${markerPosition}px`;
        
        // Calculate and display time at cursor position
        const percentage = boundedX / canvasRect.width;
        const timeAtCursor = percentage * Spicetify.Player.getDuration();
        this.seekheadTime.textContent = this.formatTime(timeAtCursor);
        
        // Position the time display
        this.seekheadTime.style.left = `${markerPosition}px`;
        
        // Ensure the seekhead marker is visible
        this.seekheadMarker.style.opacity = '1';
        this.seekheadTime.style.opacity = '1';
      }

      onMouseEnter() {
        this.seekheadMarker.style.opacity = '1';
        this.seekheadTime.style.opacity = '1';
      }

      onMouseLeave() {
        this.seekheadMarker.style.opacity = '0';
        this.seekheadTime.style.opacity = '0';
      }

      updateColors() {
        debug("Updating colors");
        if (this.canvas && this.waveformData) {
          this.drawWaveform();
        } else {
          debug("Skipping color update: Canvas or waveform data not ready");
        }
      }

      restoreOriginalSeekBar() {
        debug("Restoring original seek bar");
        if (this.originalSeekBar && this.customSeekBar && this.originalSeekBarParent) {
          // Remove our custom seekbar
          this.originalSeekBarParent.removeChild(this.customSeekBar);

          // Restore the original seekbar
          if (this.originalSeekBarNextSibling) {
            this.originalSeekBarParent.insertBefore(this.originalSeekBar, this.originalSeekBarNextSibling);
          } else {
            this.originalSeekBarParent.appendChild(this.originalSeekBar);
          }

          // Clear our references
          this.customSeekBar = null;
          this.canvas = null;

          // Remove event listeners
          if (this.customSeekBar) {
            this.customSeekBar.removeEventListener('mousemove', this.onMouseMove);
            this.customSeekBar.removeEventListener('mouseenter', this.onMouseEnter);
            this.customSeekBar.removeEventListener('mouseleave', this.onMouseLeave);
          }

          this.usingCustomSeekBar = false;
          debug("Reverted to original seekbar");
        } else {
          error("Failed to restore original seek bar: Some elements are missing");
        }
      }
      
      formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes < 60) {
          return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
      }

      resetSeekheadVisibility() {
        if (this.seekheadMarker) {
          this.seekheadMarker.style.opacity = '0';
        }
        if (this.seekheadTime) {
          this.seekheadTime.style.opacity = '0';
        }
      }

      handleFetchFailure() {
        cancelAnimationFrame(this.loadingAnimationFrame);  // Stop the loading animation
        this.restoreOriginalSeekBar();
        debug("Reverted to original seekbar due to fetch failure");
      }
    }

    new WaveformSeekbar();
  }

  // Start the initialization process
  debug("Starting Waveform extension");
  waitForSpicetify();
})();
