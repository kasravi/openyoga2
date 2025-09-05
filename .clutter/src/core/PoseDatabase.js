(function(){
  class PoseDatabase {
    constructor(jsonUrl) {
      this.jsonUrl = jsonUrl || 'poses.json';
      this._poses = null;
      this._byName = new Map();
    }

    async load() {
      if (this._poses) return this._poses;
      const res = await fetch(this.jsonUrl);
      if (!res.ok) throw new Error('Failed to load poses.json');
      const data = await res.json();
      this._poses = Array.isArray(data) ? data : [];
      this._byName.clear();
      for (const p of this._poses) {
        if (p && p.name) this._byName.set(p.name, p);
      }
      return this._poses;
    }

    getAll() { return this._poses || []; }

    getByName(name) {
      return this._byName.get(name) || null;
    }

    exists(name) { return this._byName.has(name); }
  }

  window.PoseDatabase = PoseDatabase;
})();