import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Types ---

type ToolType = 'DRILL' | 'VACUUM' | 'ARM' | 'NOZZLE' | 'HEATER';
// STAGES:
// INTRO -> DEMOLISH (Angular) -> CLEAN -> CONSTRUCT (Radial Loop) -> HEAT (Global) -> VICTORY
type GameStage = 'INTRO' | 'DEMOLISH' | 'CLEAN' | 'CONSTRUCT' | 'HEAT' | 'VICTORY';

interface Segment {
  id: number;
  // Geometry
  startAngle: number;
  endAngle: number;
  rInner: number;
  rOuter: number;
  // State
  hp: number; // 0-100 (Used for Demolish, Mold, Pour, Heat)
  state: 'intact' | 'broken' | 'empty' | 'molded' | 'filled' | 'concrete' | 'cured'; 
  // 'concrete' means filled + demolded
}

interface Debris {
  id: number;
  x: number;
  y: number;
  size: number;
  rotation: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

// --- Constants ---

const GAME_WIDTH = window.innerWidth;
const GAME_HEIGHT = window.innerHeight;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;
const MIN_DIM = Math.min(GAME_WIDTH, GAME_HEIGHT);
const R_INNER_BASE = MIN_DIM * 0.15;
const R_OUTER_BASE = MIN_DIM * 0.40; // Slightly reduced for mobile padding

// Constraints for robot movement
const R_ROBOT_MIN = R_INNER_BASE + 20;
const R_ROBOT_MAX = R_OUTER_BASE + 40; 

const C = {
  HUAXI_ORANGE: '#ff5722',
  HUAXI_DARK: '#d84315',
  BRICK_RED: '#8d6e63', 
  STEEL_GREY: '#cfd8dc',
  STEEL_DARK: '#37474f',
  BG_DARK: '#121212',
  LAVA: '#ff3d00',
  LASER_OFF: 'rgba(255, 0, 0, 0.4)',
  LASER_ON: 'rgba(0, 255, 0, 0.8)',
};

const TOOLS = [
  { id: 'DRILL', name: '液压破碎', desc: '拆除旧衬', color: '#ef5350', key: '1' },
  { id: 'VACUUM', name: '高压清理', desc: '吸除废渣', color: '#ab47bc', key: '2' },
  { id: 'ARM', name: '机械臂', desc: '支模/拆模', color: '#ffa726', key: '3' },
  { id: 'NOZZLE', name: '浇筑作业', desc: '注入材料', color: '#29b6f6', key: '4' },
  { id: 'HEATER', name: '烘炉温控', desc: '整体固化', color: '#ff7043', key: '5' },
];

// --- Math Helpers ---

const d2r = (d: number) => (d - 90) * (Math.PI / 180);
const polarToCart = (r: number, thetaDeg: number) => ({
  x: CX + r * Math.cos(d2r(thetaDeg)),
  y: CY + r * Math.sin(d2r(thetaDeg)),
});

// Create SVG Path for an annular sector
const describeArc = (x: number, y: number, rIn: number, rOut: number, startAngle: number, endAngle: number) => {
  // Handle full circle case
  if (endAngle - startAngle >= 359.9) {
      return [
          "M", x, y - rOut,
          "A", rOut, rOut, 0, 1, 1, x, y + rOut,
          "A", rOut, rOut, 0, 1, 1, x, y - rOut,
          "M", x, y - rIn,
          "A", rIn, rIn, 0, 1, 0, x, y + rIn,
          "A", rIn, rIn, 0, 1, 0, x, y - rIn,
          "Z"
      ].join(" ");
  }

  const start = polarToCart(rOut, endAngle);
  const end = polarToCart(rOut, startAngle);
  const start2 = polarToCart(rIn, endAngle);
  const end2 = polarToCart(rIn, startAngle);

  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", start.x, start.y,
    "A", rOut, rOut, 0, largeArc, 0, end.x, end.y,
    "L", end2.x, end2.y,
    "A", rIn, rIn, 0, largeArc, 1, start2.x, start2.y,
    "Z"
  ].join(" ");
};

// --- Mobile Controls Components ---

const Joystick = ({ onMove }: { onMove: (x: number, y: number) => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleTouch = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let clientX, clientY;
    if ('touches' in e) {
       clientX = e.touches[0].clientX;
       clientY = e.touches[0].clientY;
       setActive(true);
    } else {
       if ((e as React.MouseEvent).buttons !== 1) return;
       clientX = (e as React.MouseEvent).clientX;
       clientY = (e as React.MouseEvent).clientY;
       setActive(true);
    }

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxDist = rect.width / 2;

    let finalX = deltaX;
    let finalY = deltaY;

    if (dist > maxDist) {
       finalX = (deltaX / dist) * maxDist;
       finalY = (deltaY / dist) * maxDist;
    }

    setPos({ x: finalX, y: finalY });
    onMove(finalX / maxDist, finalY / maxDist);
  };

  const handleEnd = () => {
    setActive(false);
    setPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  return (
    <div 
      ref={containerRef}
      onTouchStart={handleTouch}
      onTouchMove={handleTouch}
      onTouchEnd={handleEnd}
      onMouseDown={handleTouch} // For testing on desktop
      onMouseMove={(e) => active && handleTouch(e)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      style={{
        width: '120px', height: '120px',
        background: 'rgba(255, 255, 255, 0.1)',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        borderRadius: '50%',
        position: 'relative',
        backdropFilter: 'blur(2px)',
        touchAction: 'none'
      }}
    >
      <div style={{
        width: '50px', height: '50px',
        background: active ? C.HUAXI_ORANGE : 'rgba(255, 255, 255, 0.5)',
        borderRadius: '50%',
        position: 'absolute',
        top: '50%', left: '50%',
        transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
        transition: active ? 'none' : 'all 0.1s ease-out'
      }} />
    </div>
  );
};

// --- App Component ---

const App = () => {
  // Game State
  const [stage, setStage] = useState<GameStage>('INTRO');
  
  // Construct Loop State
  const [activeLayer, setActiveLayer] = useState(0); // 0 to 3 (Inner to Outer)
  const [constructStep, setConstructStep] = useState<'MOLD' | 'POUR' | 'DEMOLD'>('MOLD');

  const [robot, setRobot] = useState({ x: CX, y: CY + R_INNER_BASE + 50, angle: 0 });
  const [activeToolIdx, setActiveToolIdx] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [debris, setDebris] = useState<Debris[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [shake, setShake] = useState(0);
  const [targetLocked, setTargetLocked] = useState(false); 
  const [globalTemp, setGlobalTemp] = useState(0); // For Heating Stage
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  
  // Toast Message System
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Refs for loop
  const requestRef = useRef<number | null>(null);
  const keysPressed = useRef<Set<string>>(new Set());
  const joystickRef = useRef({ x: 0, y: 0 });
  const robotRef = useRef(robot);
  const segmentsRef = useRef<Segment[]>([]);
  const debrisRef = useRef<Debris[]>([]);
  const stageRef = useRef(stage);
  const activeToolRef = useRef(activeToolIdx);
  const activeLayerRef = useRef(activeLayer);
  const constructStepRef = useRef(constructStep);
  const globalTempRef = useRef(globalTemp);
  const isWorkingRef = useRef(isWorking);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Sync refs
  useEffect(() => { robotRef.current = robot; }, [robot]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { debrisRef.current = debris; }, [debris]);
  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => { activeToolRef.current = activeToolIdx; }, [activeToolIdx]);
  useEffect(() => { activeLayerRef.current = activeLayer; }, [activeLayer]);
  useEffect(() => { constructStepRef.current = constructStep; }, [constructStep]);
  useEffect(() => { globalTempRef.current = globalTemp; }, [globalTemp]);
  useEffect(() => { isWorkingRef.current = isWorking; }, [isWorking]);

  const showToast = (msg: string) => {
      setToastMessage(msg);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  };

  // Init Game
  const initGame = () => {
    // Stage 1: Demolish - Angular Segments
    const initSegs: Segment[] = [];
    for (let i = 0; i < 4; i++) {
        initSegs.push({
            id: i,
            startAngle: i * 90,
            endAngle: (i + 1) * 90,
            rInner: R_INNER_BASE,
            rOuter: R_OUTER_BASE,
            hp: 100, 
            state: 'intact',
        });
    }
    setSegments(initSegs);
    setDebris([]);
    setStage('DEMOLISH');
    setActiveToolIdx(0);
    setRobot({ x: CX, y: CY + R_INNER_BASE + 60, angle: 0 });
    setActiveLayer(0);
    setConstructStep('MOLD');
    setGlobalTemp(0);
    setTargetLocked(false);
    setActiveSegmentId(null);
    setToastMessage("工序1: 拆除旧衬。华西团队，准备作业！");
  };

  const returnToMenu = () => {
    setStage('INTRO');
    setRobot({ x: CX, y: CY + R_INNER_BASE + 50, angle: 0 });
    setSegments([]);
    setDebris([]);
    setParticles([]);
    setTargetLocked(false);
    setIsWorking(false);
    setToastMessage(null);
  };

  const initConstruction = () => {
     // Create 4 Concentric Rings for construction
     const segs: Segment[] = [];
     const totalThickness = R_OUTER_BASE - R_INNER_BASE;
     const layerThickness = totalThickness / 4;

     for (let i = 0; i < 4; i++) {
        segs.push({
            id: i, // Layer ID
            startAngle: 0,
            endAngle: 360,
            rInner: R_INNER_BASE + (i * layerThickness),
            rOuter: R_INNER_BASE + ((i+1) * layerThickness),
            hp: 0,
            state: 'empty' // All start empty
        });
     }
     setSegments(segs);
     setActiveLayer(0);
     setConstructStep('MOLD');
     // Robot position reset slightly for convenience
     setRobot({ x: CX, y: CY + R_INNER_BASE + 20, angle: 90 });
     showToast("进入浇筑阶段：由内向外，层层推进。");
  };

  // Input Handling
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysPressed.current.add(e.code);
      if (['Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)) {
        const idx = parseInt(e.key) - 1;
        if (stage !== 'INTRO' && stage !== 'VICTORY') setActiveToolIdx(idx);
      }
      if (e.code === 'Space') setIsWorking(true);
    };
    const up = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.code);
      if (e.code === 'Space') setIsWorking(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [stage]);

  // --- Game Loop ---
  const gameLoop = useCallback(() => {
    const currStage = stageRef.current;
    const currTool = activeToolRef.current;
    const currLayer = activeLayerRef.current;
    const currStep = constructStepRef.current;

    // 1. Robot Movement (Keyboard + Joystick)
    let dx = 0; 
    let dy = 0;
    
    // Keyboard
    if (keysPressed.current.has('KeyW') || keysPressed.current.has('ArrowUp')) dy -= 1;
    if (keysPressed.current.has('KeyS') || keysPressed.current.has('ArrowDown')) dy += 1;
    if (keysPressed.current.has('KeyA') || keysPressed.current.has('ArrowLeft')) dx -= 1;
    if (keysPressed.current.has('KeyD') || keysPressed.current.has('ArrowRight')) dx += 1;

    // Joystick
    dx += joystickRef.current.x;
    dy += joystickRef.current.y;

    let newRobot = { ...robotRef.current };
    
    // Check if moving (with threshold for joystick jitter)
    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
      const speed = 8; // Slightly reduced base speed for better mobile control
      
      // Calculate potential new position
      let nextX = newRobot.x + dx * speed;
      let nextY = newRobot.y + dy * speed;

      // Radial Collision Check (Keep robot inside the donut)
      const distFromCenter = Math.hypot(nextX - CX, nextY - CY);
      
      // Simple correction: If outside max radius, pull back. If inside min radius, push out.
      if (distFromCenter > R_ROBOT_MAX) {
          const angle = Math.atan2(nextY - CY, nextX - CX);
          nextX = CX + R_ROBOT_MAX * Math.cos(angle);
          nextY = CY + R_ROBOT_MAX * Math.sin(angle);
      } else if (distFromCenter < R_ROBOT_MIN) {
          const angle = Math.atan2(nextY - CY, nextX - CX);
          nextX = CX + R_ROBOT_MIN * Math.cos(angle);
          nextY = CY + R_ROBOT_MIN * Math.sin(angle);
      }

      newRobot.x = nextX;
      newRobot.y = nextY;
      
      // Instant Rotation (Snappy controls)
      const targetAngle = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
      newRobot.angle = targetAngle;
    }

    // Boundary (Screen box)
    newRobot.x = Math.max(50, Math.min(GAME_WIDTH - 50, newRobot.x));
    newRobot.y = Math.max(50, Math.min(GAME_HEIGHT - 50, newRobot.y));

    // 2. Interaction Logic
    let locked = false;
    let shaking = false;
    let activeSegId: number | null = null;
    
    const distFromCenter = Math.hypot(newRobot.x - CX, newRobot.y - CY);
    
    // DEMOLISH & HEAT are somewhat region agnostic, CONSTRUCT is layer specific
    let targetSeg: Segment | undefined;

    if (currStage === 'DEMOLISH') {
       // Find closest segment based on angle
       const rAngleRad = Math.atan2(newRobot.y - CY, newRobot.x - CX);
       let rAngleDeg = (rAngleRad * 180 / Math.PI) + 90;
       if (rAngleDeg < 0) rAngleDeg += 360;
       const targetSegIdx = Math.floor(rAngleDeg / 90) % 4;
       targetSeg = segmentsRef.current[targetSegIdx];

       // Range check: Must be near ring
       if (Math.abs(distFromCenter - ((R_INNER_BASE+R_OUTER_BASE)/2)) > 200) targetSeg = undefined;
    } 
    else if (currStage === 'CONSTRUCT') {
       // Target is always the active layer ring
       targetSeg = segmentsRef.current[currLayer];
    }
    else if (currStage === 'HEAT') {
       // Anywhere inside
       if (distFromCenter < R_OUTER_BASE + 80 && distFromCenter > R_INNER_BASE - 20) {
          targetSeg = segmentsRef.current[0]; // Dummy target
       }
    }

    // Check Logic
    if (currStage !== 'INTRO' && currStage !== 'VICTORY') {
      
      // Clean Stage
      if (currStage === 'CLEAN' && currTool === 1) {
          // Check if any debris is near
          const vacuumRange = 350;
          const debrisNearby = debrisRef.current.some(d => Math.hypot(d.x - newRobot.x, d.y - newRobot.y) < vacuumRange);
          if (debrisNearby) locked = true;
      }
      // Heat Stage
      else if (currStage === 'HEAT' && currTool === 4 && targetSeg) {
          locked = true;
          activeSegId = 999; // Special ID for global heat
      }
      // Demolish Stage
      else if (currStage === 'DEMOLISH' && currTool === 0 && targetSeg && targetSeg.state === 'intact') {
          // Simple distance check (Angle check done above)
          locked = true;
          activeSegId = targetSeg.id;
      }
      // Construct Stage
      else if (currStage === 'CONSTRUCT' && targetSeg) {
          // Distance Check to ensure we are near the ring we are building
          const ringRadius = (targetSeg.rInner + targetSeg.rOuter) / 2;
          const distDiff = Math.abs(distFromCenter - ringRadius);
          const inRange = distDiff < 100; // Forgiving range

          if (inRange) {
            if (currStep === 'MOLD' && currTool === 2 && targetSeg.state === 'empty') locked = true;
            if (currStep === 'POUR' && currTool === 3 && targetSeg.state === 'molded') locked = true;
            if (currStep === 'DEMOLD' && currTool === 2 && targetSeg.state === 'filled') locked = true; 
            
            if (locked) activeSegId = targetSeg.id;
          }
      }

      // WORK ACTION
      // Check both keyboard Space and Touch Button
      const working = keysPressed.current.has('Space') || isWorkingRef.current;

      if (working && locked) {
        shaking = true;
        const speedMultiplier = 3.0; 

        if (currStage === 'DEMOLISH' && targetSeg) {
            targetSeg.hp = Math.max(0, targetSeg.hp - 1 * speedMultiplier);
            if (targetSeg.hp <= 0 && targetSeg.state === 'intact') {
                targetSeg.state = 'broken';
                targetSeg.hp = 0;
                // Spawn debris
                const d: Debris[] = [];
                for(let k=0; k<6; k++) {
                    const radius = (R_INNER_BASE + R_OUTER_BASE) / 2 + (Math.random()-0.5) * 80;
                    const angle = targetSeg.startAngle + Math.random() * 90;
                    d.push({
                        id: Math.random(),
                        x: polarToCart(radius, angle).x,
                        y: polarToCart(radius, angle).y,
                        size: 20 + Math.random() * 20,
                        rotation: Math.random() * 360
                    });
                }
                setDebris(prev => [...prev, ...d]);
            }
        }
        else if (currStage === 'CONSTRUCT' && targetSeg) {
            // MOLD (Arm)
            if (currStep === 'MOLD') {
                targetSeg.hp = Math.min(100, targetSeg.hp + 1.5 * speedMultiplier);
                if (targetSeg.hp >= 100) {
                    targetSeg.state = 'molded';
                    targetSeg.hp = 0; 
                    setConstructStep('POUR');
                    showToast("模具安装牢固！请切换至 [4] 号浇注枪注入华西耐材。");
                }
            } 
            // POUR (Nozzle)
            else if (currStep === 'POUR') {
                targetSeg.hp = Math.min(100, targetSeg.hp + 1.0 * speedMultiplier);
                if (targetSeg.hp >= 100) {
                    targetSeg.state = 'filled';
                    targetSeg.hp = 0;
                    setConstructStep('DEMOLD');
                    showToast("浇筑饱满！请切换至 [3] 号机械臂拆除模具。");
                }
            }
            // DEMOLD (Arm)
            else if (currStep === 'DEMOLD') {
                targetSeg.hp = Math.min(100, targetSeg.hp + 2.0 * speedMultiplier); 
                if (targetSeg.hp >= 100) {
                    targetSeg.state = 'concrete';
                    targetSeg.hp = 0;
                    // Layer Complete
                    if (currLayer < 3) {
                        setActiveLayer(currLayer + 1);
                        setConstructStep('MOLD');
                        showToast(`第 ${currLayer + 1} 层完工！华西工艺，层层把关！请准备架设下一层模具。`);
                    } else {
                        // All layers done
                        setStage('HEAT');
                        setActiveToolIdx(4);
                        showToast("所有浇筑层施工完毕！切换至 [5] 号烘枪进入整体烘炉工序。");
                    }
                }
            }
        }
        else if (currStage === 'HEAT') {
             const newTemp = globalTempRef.current + 0.3 * speedMultiplier;
             setGlobalTemp(Math.min(100, newTemp));
             if (newTemp >= 100) {
                 setStage('VICTORY');
             }
        }
        
        // Particles
        if (Math.random() > 0.5) {
            setParticles(prev => [...prev, {
                id: Math.random(),
                x: newRobot.x + (Math.random()-0.5)*20,
                y: newRobot.y + (Math.random()-0.5)*20,
                vx: (Math.random()-0.5)*5,
                vy: (Math.random()-0.5)*5,
                life: 1.0,
                color: (currStage === 'CONSTRUCT' && currStep === 'POUR') ? '#ccc' : currStage === 'HEAT' ? '#ffeb3b' : '#ff5722',
                size: Math.random() * 5 + 2
            }]);
        }
      }
    }

    // Special Clean Logic
    // Check Touch Button here too
    const isCleaning = (keysPressed.current.has('Space') || isWorkingRef.current);
    if (currStage === 'CLEAN' && isCleaning && currTool === 1) {
       shaking = true;
       const vacuumRange = 400; // Massive range
       const remainingDebris = debrisRef.current.filter(d => {
          const dist = Math.hypot(d.x - newRobot.x, d.y - newRobot.y);
          if (dist < vacuumRange) {
              return false; 
          }
          return true;
       });
       if (remainingDebris.length < debrisRef.current.length) {
          setDebris(remainingDebris);
          setParticles(prev => [...prev, {
                id: Math.random(),
                x: newRobot.x,
                y: newRobot.y,
                vx: (Math.random()-0.5)*2,
                vy: (Math.random()-0.5)*2,
                life: 0.5,
                color: '#fff',
                size: 2
            }]);
       }
    }

    // Stage Transitions (Auto)
    const allSegs = segmentsRef.current;
    if (currStage === 'DEMOLISH' && allSegs.length > 0 && allSegs.every(s => s.state === 'broken')) {
       setStage('CLEAN');
       setActiveToolIdx(1);
       showToast("拆除工作完成！现场已具备清理条件。请切换至 [2] 号清理设备。");
    }
    if (currStage === 'CLEAN' && debrisRef.current.length === 0 && allSegs.length > 0) {
       setStage('CONSTRUCT');
       initConstruction(); 
       setActiveToolIdx(2);
    }

    // Particle Update
    setParticles(prev => prev.map(p => ({
       ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.08
    })).filter(p => p.life > 0));

    // Commit State
    setRobot(newRobot);
    setTargetLocked(locked);
    setActiveSegmentId(activeSegId);
    setShake(shaking ? (Math.random() - 0.5) * 5 : 0);

    requestRef.current = requestAnimationFrame(gameLoop);
  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  }, [gameLoop]);

  // --- Helpers to get current segment HP for progress bar ---
  const getCurrentProgress = () => {
     if (stage === 'DEMOLISH' && activeSegmentId !== null && segments[activeSegmentId]) {
         return 100 - segments[activeSegmentId].hp;
     }
     if (stage === 'CONSTRUCT' && activeSegmentId !== null && segments[activeSegmentId]) {
         return segments[activeSegmentId].hp;
     }
     if (stage === 'HEAT') return globalTemp;
     return 0;
  }
  
  // --- Calculate Suggested Tool ---
  const getSuggestedToolIdx = () => {
      if (stage === 'DEMOLISH') return 0; // Drill
      if (stage === 'CLEAN') return 1; // Vacuum
      if (stage === 'CONSTRUCT') {
          if (constructStep === 'MOLD' || constructStep === 'DEMOLD') return 2; // Arm
          if (constructStep === 'POUR') return 3; // Nozzle
      }
      if (stage === 'HEAT') return 4; // Heater
      return -1;
  }

  // --- Helper for hint text ---
  const getHintText = () => {
    if (stage === 'DEMOLISH') return "工序1: 使用 [1]号 破碎锤拆除旧耐火内衬";
    if (stage === 'CLEAN') return "工序2: 使用 [2]号 高压清理机清除废渣";
    if (stage === 'CONSTRUCT') {
        const layer = activeLayer + 1;
        if (constructStep === 'MOLD') return `第${layer}层/4 - 请切换 [3]号 机械臂进行 [架模]`;
        if (constructStep === 'POUR') return `第${layer}层/4 - 请切换 [4]号 浇注枪进行 [浇筑]`;
        if (constructStep === 'DEMOLD') return `第${layer}层/4 - 请切换 [3]号 机械臂进行 [拆模]`;
    }
    if (stage === 'HEAT') return "工序5: 使用 [5]号 烘枪进行整体烘炉预热";
    return "提示: 摇杆移动，按键作业";
  }

  // --- Render ---

  const patterns = (
    <defs>
      {/* Improved Refractory Brick Pattern */}
      <pattern id="p-bricks" x="0" y="0" width="30" height="20" patternUnits="userSpaceOnUse">
        <rect width="30" height="20" fill="#4e342e" /> {/* Mortar color */}
        <rect x="1" y="1" width="28" height="8" fill={C.BRICK_RED} />
        <rect x="16" y="11" width="14" height="8" fill={C.BRICK_RED} />
        <rect x="1" y="11" width="13" height="8" fill={C.BRICK_RED} />
      </pattern>
      
      <pattern id="p-cracks" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M10,10 L15,5 L20,10 M30,30 L25,35 L20,30" stroke="#000" strokeWidth="2" fill="none" opacity="0.3"/>
      </pattern>
      <pattern id="p-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M0,10 L20,10 M10,0 L10,20" stroke={C.STEEL_GREY} strokeWidth="2" />
        <rect width="20" height="20" fill="none" stroke="#555" strokeWidth="1" />
      </pattern>
    </defs>
  );

  const suggestedTool = getSuggestedToolIdx();

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#000', overflow: 'hidden', position: 'relative',
      transform: `translate(${shake}px, ${shake}px)`
    }}>
      {/* --- INTRO SCREEN --- */}
      {stage === 'INTRO' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)', color: C.HUAXI_ORANGE
        }}>
          <h1 style={{ fontSize: '10vmin', margin: 0, textShadow: '0 0 20px orangered', textAlign: 'center' }}>HUA XI ROBOTICS</h1>
          <h2 style={{ color: '#fff', fontSize: '5vmin' }}>高炉内衬智能抢修系统</h2>
          <div style={{ marginTop: 20, padding: 20, border: '1px solid #444', color: '#ccc', maxWidth: '80%', textAlign: 'left', fontSize: '3.5vmin' }}>
            <p><strong>任务:</strong> 操控机器人进行高炉内衬更换。</p>
            <p><strong>控制:</strong> 键盘(WASD/Space) 或 触屏摇杆。</p>
            <p><strong>作业:</strong> 当机器人靠近目标区域时，长按作业键。</p>
            <p><strong>流程:</strong> 拆除 -&gt; 清理 -&gt; 逐层浇筑 -&gt; 整体烘炉</p>
          </div>
          <button 
            onClick={initGame}
            style={{ marginTop: 40, padding: '15px 50px', fontSize: '5vmin', background: C.HUAXI_ORANGE, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold', borderRadius: 4 }}>
            启动系统
          </button>
        </div>
      )}

      {/* --- VICTORY SCREEN --- */}
      {stage === 'VICTORY' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.95)', color: '#4caf50'
        }}>
          <h1 style={{ fontSize: '8vmin', margin: 0, textShadow: '0 0 30px #4caf50', textAlign: 'center' }}>工程圆满完成</h1>
          <h2 style={{ color: '#fff', marginTop: 20, fontSize: '4vmin', padding: '0 20px', textAlign: 'center' }}>你已经很了解华西的工序啦，非常棒！</h2>
          <div style={{ marginTop: 40, padding: 30, background: '#111', border: '1px solid #333', textAlign: 'center', width: '80%' }}>
            <p style={{ color: '#aaa', marginBottom: 20, fontSize: '3.5vmin' }}>华西耐材 - 专业的耐火材料浇筑与喷涂解决方案</p>
            <a href="http://www.hua-xi.com" target="_blank" rel="noreferrer" 
               style={{ 
                 display: 'inline-block', padding: '15px 30px', background: C.HUAXI_ORANGE, color: 'white', 
                 textDecoration: 'none', fontSize: '4vmin', fontWeight: 'bold', borderRadius: 4 
               }}>
              了解更多华西
            </a>
          </div>
          <button 
            onClick={returnToMenu}
            style={{ marginTop: 30, padding: '10px 30px', background: 'transparent', border: '1px solid #666', color: '#888', cursor: 'pointer', fontSize: '3vmin' }}>
            返回主菜单
          </button>
        </div>
      )}

      {/* --- GAME HUD --- */}
      {(stage !== 'INTRO' && stage !== 'VICTORY') && (
        <>
           {/* RESTART BUTTON */}
           <button 
             onClick={returnToMenu}
             style={{
               position: 'absolute', top: 10, right: 10, zIndex: 90,
               background: '#333', color: '#aaa', border: '1px solid #555', padding: '5px 10px',
               cursor: 'pointer', fontSize: '0.8rem'
             }}
           >
             重置系统
           </button>

           {/* TOP STATUS BAR */}
           <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', padding: '10px 20px', pointerEvents: 'none', zIndex: 50, boxSizing: 'border-box' }}>
             <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, color: '#fff', textShadow: '0 0 10px black', fontSize: '4vmin' }}>
                  STAGE: <span style={{ color: C.HUAXI_ORANGE }}>{stage}</span>
                </h2>
                <div style={{ background: '#333', padding: '5px 15px', borderRadius: 20, color: '#fff', fontSize: '3vmin' }}>
                   工具: <strong style={{ color: TOOLS[activeToolIdx].color }}>{TOOLS[activeToolIdx].name}</strong>
                </div>
             </div>
             {/* HINT BAR */}
             <div style={{ marginTop: 5, color: '#ddd', fontSize: '3.5vmin', background: 'rgba(0,0,0,0.7)', padding: '5px 15px', display: 'inline-block', borderRadius: 4, borderLeft: `5px solid ${C.HUAXI_ORANGE}`, fontWeight: 'bold', maxWidth: '100%' }}>
                {getHintText()}
             </div>
           </div>

           {/* TOAST MESSAGE */}
           {toastMessage && (
             <div style={{
               position: 'absolute', top: '25%', left: '50%', transform: 'translateX(-50%)',
               background: 'rgba(0, 0, 0, 0.8)', padding: '15px 30px', borderRadius: 8,
               border: `2px solid ${C.HUAXI_ORANGE}`, color: '#fff', fontSize: '4vmin',
               zIndex: 99, textAlign: 'center', boxShadow: '0 0 20px rgba(255, 87, 34, 0.5)',
               width: '80%',
               animation: 'fadeInOut 4s forwards'
             }}>
               {toastMessage}
             </div>
           )}
           
           {/* TOOLBAR - Adjusted Position for Mobile */}
           <div style={{ 
             position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', 
             display: 'flex', gap: '2vmin', zIndex: 50, 
             pointerEvents: 'auto',
             width: '90%', justifyContent: 'center'
           }}>
             {TOOLS.map((t, idx) => {
                const isActive = activeToolIdx === idx;
                const isSuggested = suggestedTool === idx;
                return (
                  <div key={t.id} 
                    onClick={() => setActiveToolIdx(idx)}
                    style={{
                      flex: 1, aspectRatio: '1/1', maxWidth: '70px', background: isActive ? '#444' : '#222',
                      border: isActive ? `3px solid ${t.color}` : isSuggested ? `3px dashed ${t.color}` : '2px solid #444',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      color: isActive ? '#fff' : '#666',
                      borderRadius: 6, transition: 'all 0.2s', opacity: (stage==='CONSTRUCT' && idx!==2 && idx!==3) ? 0.3 : 1,
                      transform: isSuggested && !isActive ? 'scale(1.1)' : 'scale(1)',
                      boxShadow: isSuggested && !isActive ? `0 0 15px ${t.color}` : 'none',
                      cursor: 'pointer'
                    }}>
                    <div style={{ fontWeight: 'bold', fontSize: '4vmin' }}>{t.key}</div>
                    <div style={{ fontSize: '2vmin', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', textAlign: 'center' }}>{t.name}</div>
                    {isSuggested && !isActive && <div style={{ fontSize: '2vmin', color: t.color, fontWeight: 'bold' }}>推荐</div>}
                  </div>
                );
             })}
           </div>

           {/* --- TOUCH CONTROLS (Always rendered, usable on touch devices) --- */}
           
           {/* Left Joystick */}
           <div style={{ position: 'absolute', bottom: '120px', left: '20px', zIndex: 60 }}>
              <Joystick onMove={(x, y) => { joystickRef.current = { x, y }; }} />
           </div>

           {/* Right Action Button */}
           <div 
              onTouchStart={(e) => { e.preventDefault(); setIsWorking(true); }}
              onTouchEnd={(e) => { e.preventDefault(); setIsWorking(false); }}
              onMouseDown={() => setIsWorking(true)}
              onMouseUp={() => setIsWorking(false)}
              onMouseLeave={() => setIsWorking(false)}
              style={{
                position: 'absolute', bottom: '120px', right: '20px', zIndex: 60,
                width: '100px', height: '100px',
                background: isWorking ? C.HUAXI_ORANGE : 'rgba(255, 255, 255, 0.1)',
                border: `4px solid ${isWorking ? '#fff' : 'rgba(255, 255, 255, 0.3)'}`,
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 'bold', fontSize: '1.2rem',
                userSelect: 'none', backdropFilter: 'blur(2px)', cursor: 'pointer',
                touchAction: 'none'
              }}
           >
              作业
           </div>

        </>
      )}

      {/* --- GAME WORLD --- */}
      <svg width={GAME_WIDTH} height={GAME_HEIGHT} style={{ display: 'block' }}>
         {patterns}

         {/* Background Floor */}
         <circle cx={CX} cy={CY} r={R_OUTER_BASE + 50} fill="#1a1a1a" stroke="#333" strokeWidth="2" />
         <circle cx={CX} cy={CY} r={R_INNER_BASE - 20} fill="#000" />

         {/* Segments */}
         {segments.map(seg => {
            let fill = '#222';
            let stroke = '#444';
            let opacity = 1;
            
            if (stage === 'DEMOLISH') {
                fill = seg.state === 'intact' ? "url(#p-bricks)" : '#1a1a1a'; // Use bricks or empty dark
            } 
            else if (stage === 'CONSTRUCT') {
                if (seg.state === 'empty') { fill = '#111'; stroke = '#222'; }
                if (seg.state === 'molded') { fill = "url(#p-grid)"; stroke = C.STEEL_GREY; }
                if (seg.state === 'filled') { fill = '#546e7a'; stroke = '#607d8b'; } // Wet concrete
                if (seg.state === 'concrete') { fill = '#78909c'; stroke = '#fff'; } // Smooth concrete
            }
            else if (stage === 'HEAT') {
                // Determine heat color
                const ratio = globalTemp / 100;
                // Interpolate Grey to Red to Bright Orange
                fill = `rgb(${120 + ratio * 135}, ${144 - ratio * 100}, ${156 - ratio * 156})`;
            }

            // Highlight active work
            if (activeSegmentId === seg.id || (activeSegmentId === 999 && stage === 'HEAT')) {
               stroke = '#fff';
               fill = stage === 'HEAT' ? fill : fill; 
            }

            return (
              <path 
                key={seg.id}
                d={describeArc(CX, CY, seg.rInner, seg.rOuter, seg.startAngle, seg.endAngle)}
                fill={fill}
                stroke={stroke}
                strokeWidth={activeSegmentId === seg.id ? 3 : 1}
              />
            );
         })}

         {/* Debris */}
         {debris.map(d => (
            <g key={d.id} transform={`translate(${d.x},${d.y}) rotate(${d.rotation})`}>
               <rect x={-d.size/2} y={-d.size/2} width={d.size} height={d.size} fill="#5d4037" stroke="black" />
            </g>
         ))}

         {/* Particles */}
         {particles.map(p => (
            <circle key={p.id} cx={p.x} cy={p.y} r={p.size} fill={p.color} opacity={p.life} />
         ))}

         {/* Robot */}
         <g transform={`translate(${robot.x}, ${robot.y}) rotate(${robot.angle})`}>
             {/* Tracks */}
             <rect x={-15} y={-20} width={30} height={10} fill="#333" rx="2" />
             <rect x={-15} y={10} width={30} height={10} fill="#333" rx="2" />
             {/* Body */}
             <rect x={-12} y={-12} width={24} height={24} fill={C.HUAXI_ORANGE} rx="4" stroke="#fff" strokeWidth="2" />
             <rect x={-6} y={-6} width={12} height={12} fill="#333" rx="2" />
             {/* Head / Light */}
             <circle cx={0} cy={12} r={4} fill={targetLocked ? '#0f0' : '#f00'} />
             {/* Laser Sight */}
             <line x1={0} y1={12} x2={0} y2={targetLocked ? 80 : 200} 
                   stroke={targetLocked ? C.LASER_ON : C.LASER_OFF} 
                   strokeWidth="2" strokeDasharray="4,4" />
             {targetLocked && <circle cx={0} cy={80} r={5} fill="none" stroke="#0f0" strokeWidth="2" opacity="0.7" />}
         </g>
         
         {/* Overhead Progress Bar */}
         {(isWorking && targetLocked) && (
            <g transform={`translate(${robot.x}, ${robot.y - 40})`}>
               <rect x={-20} y={0} width={40} height={6} fill="#000" stroke="#fff" />
               <rect x={-20} y={0} width={40 * (getCurrentProgress()/100)} height={6} fill={C.HUAXI_ORANGE} />
            </g>
         )}

      </svg>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);