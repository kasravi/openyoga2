(function(){
  const DEFAULT_BREATH_SECONDS = 4; // in, out ~ 2s each (approx)

  class FlowEngine {
    constructor({ tts, poseDb, onState }) {
      this.tts = tts;
      this.poseDb = poseDb;
      this.onState = onState || (()=>{});
      this.flow = [];
      this.currentIndex = -1;
      this.isRunning = false;
      this.isPaused = false;
      this.holdBreaths = 3;
      this.breathSeconds = DEFAULT_BREATH_SECONDS;
      this._timer = null;
    }

    setBreathSeconds(sec) { this.breathSeconds = Math.max(1, sec|0); }
    setHoldBreaths(n) { this.holdBreaths = Math.max(1, n|0); }

    loadFlow(poseNamesArray) {
      this.flow = (poseNamesArray || []).filter(n => this.poseDb.exists(n));
      this.currentIndex = -1;
      this.isRunning = false;
      this.isPaused = false;
      this._clearTimer();
      this._emit();
    }

    async start() {
      if (!this.flow || this.flow.length === 0) return;
      this.isRunning = true;
      this.isPaused = false;
      this.currentIndex = -1;
      this._emit();
      await this._next();
    }

    pause() {
      this.isPaused = true;
      this._clearTimer();
      this._emit();
    }

    resume() {
      if (!this.isRunning || !this.isPaused) return;
      this.isPaused = false;
      this._emit();
      this._continueHold();
    }

    stop() {
      this.isRunning = false;
      this.isPaused = false;
      this.currentIndex = -1;
      this._clearTimer();
      if (this.tts) this.tts.cancel();
      this._emit();
    }

    async skip() {
      this._clearTimer();
      await this._next();
    }

    async _next() {
      if (!this.isRunning) return;
      this.currentIndex++;
      if (this.currentIndex >= this.flow.length) {
        this.isRunning = false;
        this._emit();
        if (this.tts) await this.tts.speak('Flow complete.');
        return;
      }

      const poseName = this.flow[this.currentIndex];
      const pose = this.poseDb.getByName(poseName);
      this._emit();

      const announce = pose?.display_name || pose?.name || poseName;
      if (this.tts) await this.tts.speak(`Now: ${announce}. Hold for ${this.holdBreaths} breaths.`);

      // Schedule hold period
      this._holdStart = Date.now();
      this._holdRemainingMs = this.holdBreaths * this.breathSeconds * 1000;
      this._continueHold();
    }

    _continueHold() {
      if (!this.isRunning || this.isPaused) return;
      const tickMs = 250;
      const elapsed = Date.now() - (this._holdStart || Date.now());
      const remaining = Math.max(0, this._holdRemainingMs - elapsed);
      this._emit({ remainingMs: remaining });
      if (remaining <= 0) {
        this._clearTimer();
        this._next();
      } else {
        this._timer = setTimeout(() => this._continueHold(), tickMs);
      }
    }

    _clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }

    _emit(extra) {
      try {
        this.onState({
          isRunning: this.isRunning,
          isPaused: this.isPaused,
          index: this.currentIndex,
          total: this.flow.length,
          currentPose: this.flow[this.currentIndex] || null,
          holdBreaths: this.holdBreaths,
          breathSeconds: this.breathSeconds,
          ...extra,
        });
      } catch (e) {}
    }
  }

  window.FlowEngine = FlowEngine;
})();