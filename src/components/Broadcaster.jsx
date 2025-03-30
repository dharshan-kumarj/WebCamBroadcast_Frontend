import React, { useState, useEffect, useRef } from 'react';
import './Broadcaster.css';

const Broadcaster = () => {
  const [streamId, setStreamId] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState('Ready to stream');
  const [viewerCount, setViewerCount] = useState(0);
  const [resolution, setResolution] = useState('640x480');
  
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const broadcasterId = useRef(`broadcaster_${Math.random().toString(36).substring(2, 15)}`);

  // Fetch a new stream ID when component mounts
  useEffect(() => {
    fetchStreamId();
    
    // Clean up when component unmounts
    return () => {
      stopStreaming();
    };
  }, []);
  
  // Fetch a stream ID from the server
  const fetchStreamId = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/get-stream-id/');
      const data = await response.json();
      setStreamId(data.stream_id);
    } catch (error) {
      console.error('Error fetching stream ID:', error);
      setStatus('Error fetching stream ID');
    }
  };
  
  // Start the broadcasting session
  const startStreaming = async () => {
    try {
      // Get video stream from camera
      const [width, height] = resolution.split('x').map(Number);
      
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: width },
          height: { ideal: height }
        }, 
        audio: true  // Enable audio for WebRTC
      });
      
      // Set the video source
      if (videoRef.current) {
        videoRef.current.srcObject = localStreamRef.current;
      }
      
      // Setup WebSocket connection for signaling
      socketRef.current = new WebSocket(`ws://localhost:8000/ws/webrtc/${streamId}/`);
      
      socketRef.current.onopen = () => {
        console.log('WebRTC signaling connection established');
        setStatus('Connected to signaling server, waiting for viewers');
        setIsStreaming(true);
        
        // Announce presence as broadcaster
        socketRef.current.send(JSON.stringify({
          type: 'broadcaster_ready',
          broadcasterId: broadcasterId.current
        }));
      };
      
      socketRef.current.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'viewer_joined') {
            const viewerId = message.viewerId;
            console.log(`New viewer joined: ${viewerId}`);
            
            // Create a new RTCPeerConnection for this viewer
            const peerConnection = createPeerConnection(viewerId);
            
            // Add tracks from local stream to the peer connection
            localStreamRef.current.getTracks().forEach(track => {
              peerConnection.addTrack(track, localStreamRef.current);
            });
            
            // Create and send an offer to the viewer
            try {
              const offer = await peerConnection.createOffer();
              await peerConnection.setLocalDescription(offer);
              
              socketRef.current.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                viewerId: viewerId,
                broadcasterId: broadcasterId.current
              }));
            } catch (error) {
              console.error('Error creating offer:', error);
            }
            
            // Update viewer count
            setViewerCount(prevCount => prevCount + 1);
          }
          else if (message.type === 'answer' && message.broadcasterId === broadcasterId.current) {
            const viewerId = message.viewerId;
            const peerConnection = peerConnectionsRef.current[viewerId];
            
            if (peerConnection && peerConnection.signalingState !== 'closed') {
              await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
              console.log(`Processed answer from viewer: ${viewerId}`);
            }
          }
          else if (message.type === 'ice_candidate' && message.broadcasterId === broadcasterId.current) {
            const viewerId = message.viewerId;
            const peerConnection = peerConnectionsRef.current[viewerId];
            
            if (peerConnection && peerConnection.signalingState !== 'closed') {
              await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
            }
          }
          else if (message.type === 'viewer_left') {
            const viewerId = message.viewerId;
            
            // Clean up the peer connection
            if (peerConnectionsRef.current[viewerId]) {
              peerConnectionsRef.current[viewerId].close();
              delete peerConnectionsRef.current[viewerId];
              
              // Update viewer count
              setViewerCount(prevCount => Math.max(0, prevCount - 1));
              console.log(`Viewer left: ${viewerId}`);
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };
      
      socketRef.current.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code}`);
        setStatus('Signaling connection closed');
        
        if (isStreaming) {
          stopStreaming();
        }
      };
      
      socketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('Signaling connection error');
      };
    } catch (error) {
      console.error('Error starting stream:', error);
      setStatus(`Error: ${error.message}`);
    }
  };
  
  // Create a new RTCPeerConnection for a viewer
  const createPeerConnection = (viewerId) => {
    // Configure ICE servers (STUN/TURN)
    const configuration = {
      iceServers: [
        { 
          urls: 'stun:stun.l.google.com:19302' 
        },
        // Add TURN servers for better NAT traversal in production
        // {
        //   urls: 'turn:your-turn-server.com:3478',
        //   username: 'username',
        //   credential: 'password'
        // }
      ]
    };
    
    const peerConnection = new RTCPeerConnection(configuration);
    
    // Store the connection
    peerConnectionsRef.current[viewerId] = peerConnection;
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          candidate: event.candidate,
          viewerId: viewerId,
          broadcasterId: broadcasterId.current
        }));
      }
    };
    
    // Log state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${viewerId}: ${peerConnection.iceConnectionState}`);
    };
    
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state for ${viewerId}: ${peerConnection.connectionState}`);
      
      // Handle disconnections
      if (peerConnection.connectionState === 'disconnected' || 
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed') {
        
        if (peerConnectionsRef.current[viewerId]) {
          peerConnectionsRef.current[viewerId].close();
          delete peerConnectionsRef.current[viewerId];
          
          // Update viewer count
          setViewerCount(prevCount => Math.max(0, prevCount - 1));
        }
      }
    };
    
    return peerConnection;
  };
  
  // Stop the broadcasting session
  const stopStreaming = () => {
    // Close all peer connections
    Object.values(peerConnectionsRef.current).forEach(pc => {
      pc.close();
    });
    peerConnectionsRef.current = {};
    
    // Close WebSocket connection
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    // Stop local media stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // Reset video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
    setStatus('Stream ended');
    setViewerCount(0);
  };
  
  // Handle resolution change
  const handleResolutionChange = (e) => {
    setResolution(e.target.value);
  };
  
  return (
    <div className="broadcaster-container">
      <h1>Live Video Broadcaster</h1>
      
      <div className="stream-info">
        <p>Stream ID: <span className="highlight">{streamId}</span></p>
        <p>Status: <span className={`highlight ${isStreaming ? 'active' : ''}`}>{status}</span></p>
        <p>Viewers: <span className="highlight">{viewerCount}</span></p>
      </div>
      
      <div className="video-container">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted
          style={{ display: isStreaming ? 'block' : 'none' }}
        />
        
        {!isStreaming && (
          <div className="placeholder">
            Camera preview will appear here when streaming starts
          </div>
        )}
      </div>
      
      <div className="settings-panel">
        <h3>Streaming Settings</h3>
        
        <div className="setting">
          <label>Resolution:</label>
          <select 
            value={resolution} 
            onChange={handleResolutionChange}
            disabled={isStreaming}
          >
            <option value="320x240">320x240 (Low)</option>
            <option value="640x480">640x480 (Medium)</option>
            <option value="1280x720">1280x720 (HD)</option>
          </select>
        </div>
      </div>
      
      <div className="controls">
        {!isStreaming ? (
          <button 
            className="start-button"
            onClick={startStreaming}
          >
            Start Broadcasting
          </button>
        ) : (
          <button 
            className="stop-button"
            onClick={stopStreaming}
          >
            Stop Broadcasting
          </button>
        )}
        
        <button 
          className="new-id-button"
          onClick={fetchStreamId}
          disabled={isStreaming}
        >
          Generate New Stream ID
        </button>
      </div>
      
      <div className="instructions">
        <h3>How to use:</h3>
        <ol>
          <li>Share your Stream ID with viewers</li>
          <li>Click "Start Broadcasting" to begin</li>
          <li>Viewers can join at: http://localhost:5173/view/{streamId}</li>
        </ol>
      </div>
    </div>
  );
};

export default Broadcaster;