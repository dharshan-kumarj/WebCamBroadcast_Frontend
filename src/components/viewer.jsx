import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './Viewer.css';

const Viewer = () => {
  const { streamId } = useParams();
  const [status, setStatus] = useState('Connecting to stream...');
  const [isConnected, setIsConnected] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState(null);
  const [viewersCount, setViewersCount] = useState(0);
  
  const socketRef = useRef(null);
  const imageRef = useRef(null);
  const viewerId = useRef(`viewer_${Math.random().toString(36).substring(2, 15)}`);
  const reconnectTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    let frameUpdateInterval = null;
    
    const connectToStream = async () => {
      if (!isMountedRef.current) return;
      
      if (socketRef.current) {
        console.log('Closing existing WebSocket connection');
        socketRef.current.close();
        socketRef.current = null;
      }
      
      try {
        setStatus('Connecting to stream...');
        console.log(`Attempting to connect to WebSocket: ws://localhost:8000/ws/broadcast/${streamId}/`);
        
        socketRef.current = new WebSocket(`ws://localhost:8000/ws/broadcast/${streamId}/`);
        
        socketRef.current.onopen = () => {
          if (!isMountedRef.current) return;
          
          console.log('✅ WebSocket connection ESTABLISHED successfully');
          setStatus('Connected to stream - waiting for video');
          setIsConnected(true);
          
          // *** FIX: Wait to ensure readyState is OPEN before sending ***
          setTimeout(() => {
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              console.log('Sending viewer_joined message');
              socketRef.current.send(JSON.stringify({
                type: 'viewer_joined',
                viewer_id: viewerId.current
              }));
            } else {
              console.warn('Cannot send viewer_joined - WebSocket not in OPEN state');
            }
          }, 500);
          
          // Set up frame update check interval
          frameUpdateInterval = setInterval(() => {
            if (frameCount === 0 && isConnected) {
              console.log('No frames received yet. Is the broadcaster sending video?');
            }
          }, 5000);
        };
        
        socketRef.current.onmessage = (event) => {
          if (!isMountedRef.current) return;
          
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'video_frame') {
              // Debug log the beginning of the data string to verify format
              if (frameCount === 0) {
                console.log(`📷 First frame received! Format check: ${data.frame.substring(0, 30)}...`);
              } else if (frameCount % 30 === 0) {
                console.log(`Received frame #${frameCount}`);
              }
              
              // Check if data.frame is a valid data URL
              if (data.frame && (data.frame.startsWith('data:image') || data.frame.startsWith('blob:'))) {
                if (imageRef.current) {
                  imageRef.current.src = data.frame;
                  imageRef.current.style.display = 'block';
                  
                  setFrameCount(prev => prev + 1);
                  setLastFrameTime(new Date());
                  setStatus('✅ Receiving video stream');
                }
              } else {
                console.error('Invalid frame data received:', 
                  data.frame ? `${data.frame.substring(0, 50)}...` : 'undefined');
              }
            } else if (data.type === 'viewer_update') {
              console.log('Viewer update received:', data);
              // Update viewers count if provided
              if (data.viewers_count) {
                setViewersCount(data.viewers_count);
              }
            } else {
              console.log('Unknown message type received:', data.type);
            }
          } catch (error) {
            console.error('Error processing message:', error);
          }
        };
        
        socketRef.current.onclose = (event) => {
          if (!isMountedRef.current) return;
          
          console.log(`WebSocket connection closed: code=${event.code}, reason=${event.reason || 'No reason provided'}`);
          setStatus(`Disconnected (code: ${event.code})`);
          setIsConnected(false);
          
          if (isMountedRef.current) {
            const reconnectDelay = Math.min(3000 * (reconnectTimerRef.current?.attempts || 0) + 1000, 10000);
            console.log(`Will attempt reconnection in ${reconnectDelay}ms`);
            
            reconnectTimerRef.current = {
              timer: setTimeout(connectToStream, reconnectDelay),
              attempts: (reconnectTimerRef.current?.attempts || 0) + 1
            };
          }
        };
        
        socketRef.current.onerror = (error) => {
          if (!isMountedRef.current) return;
          console.error('WebSocket error occurred:', error);
        };
      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        setStatus('Failed to create connection');
      }
    };
    
    connectToStream();
    
    return () => {
      console.log('Cleaning up viewer component');
      isMountedRef.current = false;
      
      if (frameUpdateInterval) {
        clearInterval(frameUpdateInterval);
      }
      
      if (reconnectTimerRef.current?.timer) {
        clearTimeout(reconnectTimerRef.current.timer);
      }
      
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
      }
    };
  }, [streamId]);
  
  // Function to check broadcaster status
  const checkBroadcaster = () => {
    // Add an endpoint to check if broadcaster is active
    console.log("Checking if broadcaster is active...");
    setStatus("Checking broadcaster status...");
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'check_broadcaster',
        viewer_id: viewerId.current
      }));
    }
  };
  
  return (
    <div className="viewer-container" style={{maxWidth: '800px', margin: '0 auto', padding: '20px'}}>
      <h1 style={{color: '#333', textAlign: 'center'}}>Stream Viewer</h1>
      
      <div className="stream-info" style={{
        background: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '5px',
        marginBottom: '20px'
      }}>
        <p>Stream ID: <span style={{fontWeight: 'bold', color: '#0066cc'}}>{streamId}</span></p>
        <p>Status: <span style={{
          fontWeight: 'bold',
          color: isConnected ? '#4CAF50' : '#f44336'
        }}>{status}</span></p>
        
        {viewersCount > 0 && (
          <p>Viewers: <span style={{fontWeight: 'bold'}}>{viewersCount}</span></p>
        )}
        
        {frameCount > 0 && (
          <>
            <p>Frames received: <span style={{fontWeight: 'bold'}}>{frameCount}</span></p>
            <p>Last frame: <span style={{fontWeight: 'bold'}}>{lastFrameTime?.toLocaleTimeString()}</span></p>
          </>
        )}
      </div>
      
      {/* Debug Panel - very useful for troubleshooting */}
      <div style={{
        background: '#f8f8f8',
        border: '1px solid #ddd',
        padding: '10px',
        marginBottom: '20px',
        fontSize: '14px'
      }}>
        <h3 style={{margin: '0 0 10px 0'}}>Connection Debug Info</h3>
        <p>WebSocket State: <span style={{fontWeight: 'bold'}}>
          {socketRef.current ? 
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socketRef.current.readyState] : 
            'Not initialized'}
        </span></p>
        <p>Video Frames: <span style={{fontWeight: 'bold'}}>
          {frameCount === 0 ? 'None received yet' : `${frameCount} frames received`}
        </span></p>
      </div>
      
      <div className="stream-container" style={{
        position: 'relative',
        width: '100%',
        height: '400px',
        background: '#000',
        marginBottom: '20px',
        borderRadius: '5px',
        overflow: 'hidden'
      }}>
        <img 
          ref={imageRef} 
          alt="Live Stream" 
          style={{
            display: 'none',  // Hide initially until frames received
            width: '100%',
            height: '100%',
            objectFit: 'contain'
          }}
        />
        
        {isConnected && frameCount === 0 && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            textAlign: 'center',
            padding: '20px'
          }}>
            <div style={{fontSize: '20px', marginBottom: '20px'}}>Connected to Stream</div>
            <div>Waiting for broadcaster to send video...</div>
            <div style={{marginTop: '20px', fontSize: '14px', color: '#ccc'}}>
              Make sure someone is broadcasting to this stream ID
            </div>
          </div>
        )}
        
        {!isConnected && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            background: 'rgba(0,0,0,0.7)'
          }}>
            <div>Connecting to stream...</div>
          </div>
        )}
      </div>
      
      <div className="controls" style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '10px',
        marginBottom: '20px'
      }}>
        <button 
          onClick={() => {
            if (socketRef.current) {
              socketRef.current.close();
            }
            
            if (reconnectTimerRef.current?.timer) {
              clearTimeout(reconnectTimerRef.current.timer);
              reconnectTimerRef.current = null;
            }
            
            setFrameCount(0);
            setLastFrameTime(null);
            
            setTimeout(() => {
              if (isMountedRef.current) {
                const connectToStream = async () => {
                  socketRef.current = new WebSocket(`ws://localhost:8000/ws/broadcast/${streamId}/`);
                  // Rest of connection logic happens in the useEffect
                };
                connectToStream();
              }
            }, 100);
          }}
          style={{
            padding: '10px 20px',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Reconnect
        </button>
        
        <button 
          onClick={checkBroadcaster}
          style={{
            padding: '10px 20px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Check Broadcaster
        </button>
        
        <button 
          onClick={() => window.history.back()}
          style={{
            padding: '10px 20px',
            background: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Back
        </button>
      </div>
      
      {/* Troubleshooting Guide */}
      <div style={{marginTop: '30px'}}>
        <h3>Troubleshooting</h3>
        <ol style={{textAlign: 'left'}}>
          <li><strong>Check if broadcaster is active</strong> - Make sure someone is currently broadcasting to stream ID: {streamId}</li>
          <li><strong>Verify video format</strong> - The broadcaster must send frames as data URLs (data:image/jpeg;base64,...)</li>
          <li><strong>Reload both pages</strong> - Try refreshing both broadcaster and viewer pages</li>
          <li><strong>Check browser console</strong> - Look for any errors in the console logs</li>
        </ol>
      </div>
    </div>
  );
};

export default Viewer;