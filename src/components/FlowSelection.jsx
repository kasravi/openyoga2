import React from 'react';
import './FlowSelection.css';

export function FlowSelection({ flows, onFlowSelect }) {
  return (
    <div className="flow-selection">
      <h1 className="app-title">Yoga Voice Assistant</h1>
      <p className="app-subtitle">Choose your practice</p>
      
      <div className="flows-grid">
        {flows.map((flow) => (
          <div 
            key={flow.id}
            className="flow-card"
            onClick={() => onFlowSelect(flow)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onFlowSelect(flow);
              }
            }}
          >
            <div className="flow-icon">
              {getFlowIcon(flow.id)}
            </div>
            <h3 className="flow-name">{flow.display_name}</h3>
            <p className="flow-description">{flow.description}</p>
            <div className="flow-meta">
              <span className="flow-duration">{flow.duration_minutes} min</span>
              <span className="flow-difficulty">{flow.difficulty}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getFlowIcon(flowId) {
  const icons = {
    sun_salutation: '☀️',
    moon_salutation: '🌙',
    morning_energizer: '⚡',
    evening_unwind: '🌅'
  };
  return icons[flowId] || '🧘‍♀️';
}
