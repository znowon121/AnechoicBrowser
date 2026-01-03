from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
from dotenv import load_dotenv
import os
import time
from datetime import datetime, timezone
from functools import wraps
from authlib.integrations.flask_client import OAuth

# 載入環境變數
load_dotenv()

# 導入資料庫相關模組
from app.database import SessionLocal, engine, Base
from app.dal import (
    create_user, get_user_by_id, get_user_by_email,
    create_friend_request, respond_friend_request, get_friend_requests,
    are_friends, get_friends,
    get_or_create_direct_conversation, save_message, list_messages,
    mark_read, get_unread_count, get_conversations
)

# 初始化資料庫表
Base.metadata.create_all(bind=engine)

base_dir = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    static_folder=os.path.join(base_dir, 'static'),
    template_folder=os.path.join(base_dir, 'templates')
)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# === [新增] Google OAuth 設定 ===
app.config['GOOGLE_CLIENT_ID'] = os.getenv('GOOGLE_CLIENT_ID')
app.config['GOOGLE_CLIENT_SECRET'] = os.getenv('GOOGLE_CLIENT_SECRET')

oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=app.config['GOOGLE_CLIENT_ID'],
    client_secret=app.config['GOOGLE_CLIENT_SECRET'],
    access_token_url='https://oauth2.googleapis.com/token',
    access_token_params=None,
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    authorize_params=None,
    api_base_url='https://www.googleapis.com/oauth2/v1/',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    client_kwargs={'scope': 'openid email profile'},
    jwks_uri='https://www.googleapis.com/oauth2/v3/certs'
)
# === [新增結束] ===

socketio = SocketIO(
    app,
    cors_allowed_origins=os.getenv('SOCKETIO_CORS_ORIGINS', '*'),
    async_mode='threading',
    logger=True,
    engineio_logger=True
)

# Debug info: help diagnose TemplateNotFound issues
print('DEBUG: base_dir =', base_dir)
print('DEBUG: app.template_folder =', app.template_folder)
try:
    print('DEBUG: templates exist =', os.path.isdir(app.template_folder))
    if os.path.isdir(app.template_folder):
        print('DEBUG: templates listing =', os.listdir(app.template_folder))
except Exception as _e:
    print('DEBUG: error inspecting templates folder:', _e)

# 在線用戶追蹤（保留在記憶體）
online_users = {}  # {user_id: socket_id}
user_sockets = {}  # {socket_id: user_id}

def get_db():
    """獲取資料庫 session"""
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

def socket_login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        socket_id = request.sid
        if socket_id not in user_sockets:
            emit('error', {'message': 'Unauthorized'})
            return
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/auth/google')
def google_login():
    """開始 Google 登入"""
    redirect_uri = url_for('google_auth_callback', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/auth/google/callback')
def google_auth_callback():
    """Google 登入回調"""
    try:
        token = google.authorize_access_token()
        user_info = google.get('userinfo').json()
        
        email = user_info['email']
        display_name = user_info['name']
        avatar_url = user_info.get('picture', '')
        
        db = get_db()
        try:
            # 檢查用戶是否存在
            user = get_user_by_email(db, email)
            
            if not user:
                # 自動註冊新用戶
                user = create_user(
                    db,
                    display_name=display_name,
                    email=email,
                    avatar_url=avatar_url
                )
            else:
                # 更新頭像
                if avatar_url:
                    user.avatar_url = avatar_url
                    db.commit()

            session['user_id'] = user.id
            
            # 導向成功頁面，並帶上參數讓 Electron 抓取
            return redirect(f'/auth/success?uid={user.id}&name={display_name}&avatar={avatar_url}')
            
        finally:
            db.close()
    except Exception as e:
        print(f"Google Login Error: {e}")
        return f"Login failed: {str(e)}", 400

@app.route('/auth/success')
def auth_success():
    """登入成功頁面"""
    return """
    <html>
        <head><title>Login Successful</title></head>
        <body style="background:#222; color:white; text-align:center; padding-top:50px; font-family:sans-serif;">
            <h1>登入成功！</h1>
            <p>正在返回應用程式...</p>
        </body>
    </html>
    """

@app.route('/auth/dev-login', methods=['POST'])
def dev_login():
    """開發模式登入"""
    if os.getenv('AUTH_MODE') != 'mock':
        return jsonify({'error': 'Mock login disabled'}), 403
    
    db = get_db()
    try:
        data = request.json
        display_name = data.get('display_name', 'Anonymous')
        email = f"{display_name.lower().replace(' ', '_')}@mock.local"
        
        # 檢查用戶是否存在
        user = get_user_by_email(db, email)
        
        if not user:
            # 建立新用戶
            user = create_user(
                db,
                display_name=display_name,
                email=email,
                avatar_url=f'https://ui-avatars.com/api/?name={display_name}&background=random'
            )
        
        session['user_id'] = user.id
        
        return jsonify({
            'user': {
                'id': user.id,
                'display_name': user.display_name,
                'avatar_url': user.avatar_url,
                'email': user.email,
                'last_seen': user.last_seen_at.isoformat() if user.last_seen_at else None
            },
            'message': 'Login successful'
        })
    finally:
        db.close()

@app.route('/auth/logout', methods=['POST'])
@login_required
def logout():
    """登出"""
    user_id = session.pop('user_id', None)
    return jsonify({'message': 'Logout successful'})

@app.route('/api/me', methods=['GET'])
@login_required
def get_current_user():
    """獲取當前用戶資訊"""
    db = get_db()
    try:
        user_id = session['user_id']
        user = get_user_by_id(db, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'user': {
                'id': user.id,
                'display_name': user.display_name,
                'avatar_url': user.avatar_url,
                'email': user.email,
                'last_seen': user.last_seen_at.isoformat() if user.last_seen_at else None
            }
        })
    finally:
        db.close()

@app.route('/api/users', methods=['GET'])
@login_required
def get_users():
    """獲取所有用戶列表（排除自己）"""
    db = get_db()
    try:
        current_user_id = session['user_id']
        
        # 簡單查詢所有用戶
        from app.models import User
        all_users = db.query(User).filter(User.id != current_user_id).all()
        
        user_list = [{
            'id': user.id,
            'display_name': user.display_name,
            'avatar_url': user.avatar_url,
            'email': user.email,
            'is_online': user.id in online_users,
            'last_seen': user.last_seen_at.isoformat() if user.last_seen_at else None
        } for user in all_users]
        
        return jsonify({'users': user_list})
    finally:
        db.close()

@app.route('/api/friends', methods=['GET'])
@login_required
def get_friends_route():
    """獲取朋友列表"""
    db = get_db()
    try:
        user_id = session['user_id']
        friends = get_friends(db, user_id)
        
        friend_list = [{
            'id': friend.id,
            'display_name': friend.display_name,
            'avatar_url': friend.avatar_url,
            'email': friend.email,
            'is_online': friend.id in online_users,
            'last_seen': friend.last_seen_at.isoformat() if friend.last_seen_at else None
        } for friend in friends]
        
        return jsonify({'friends': friend_list})
    finally:
        db.close()

@app.route('/api/friend-requests', methods=['GET'])
@login_required
def get_friend_requests_route():
    """獲取朋友申請列表"""
    db = get_db()
    try:
        user_id = session['user_id']
        received, sent = get_friend_requests(db, user_id)
        
        received_list = [{
            'id': req.id,
            'from_user_id': req.from_user_id,
            'to_user_id': req.to_user_id,
            'status': req.status.value,
            'created_at': req.created_at.isoformat(),
            'from_user': {
                'id': req.from_user.id,
                'display_name': req.from_user.display_name,
                'avatar_url': req.from_user.avatar_url
            }
        } for req in received]
        
        sent_list = [{
            'id': req.id,
            'from_user_id': req.from_user_id,
            'to_user_id': req.to_user_id,
            'status': req.status.value,
            'created_at': req.created_at.isoformat(),
            'to_user': {
                'id': req.to_user.id,
                'display_name': req.to_user.display_name,
                'avatar_url': req.to_user.avatar_url
            }
        } for req in sent]
        
        return jsonify({'received': received_list, 'sent': sent_list})
    finally:
        db.close()

@app.route('/api/friend-requests', methods=['POST'])
@login_required
def send_friend_request():
    """發送朋友申請"""
    db = get_db()
    try:
        user_id = session['user_id']
        data = request.json
        to_user_id = data.get('to_user_id')
        
        if not to_user_id:
            return jsonify({'error': 'to_user_id is required'}), 400
        
        # 檢查目標用戶是否存在
        to_user = get_user_by_id(db, to_user_id)
        if not to_user:
            return jsonify({'error': 'User not found'}), 404
        
        # 檢查是否已經是朋友
        if are_friends(db, user_id, to_user_id):
            return jsonify({'error': 'Already friends'}), 400
        
        # 建立朋友申請
        try:
            new_request = create_friend_request(db, user_id, to_user_id)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # 通知對方（如果在線）
        if to_user_id in online_users:
            from_user = get_user_by_id(db, user_id)
            socketio.emit('friend_request:new', {
                'request': {
                    'id': new_request.id,
                    'from_user_id': new_request.from_user_id,
                    'to_user_id': new_request.to_user_id,
                    'status': new_request.status.value,
                    'created_at': new_request.created_at.isoformat(),
                    'from_user': {
                        'id': from_user.id,
                        'display_name': from_user.display_name,
                        'avatar_url': from_user.avatar_url
                    }
                }
            }, room=online_users[to_user_id])
        
        return jsonify({
            'request': {
                'id': new_request.id,
                'from_user_id': new_request.from_user_id,
                'to_user_id': new_request.to_user_id,
                'status': new_request.status.value,
                'created_at': new_request.created_at.isoformat()
            }
        })
    finally:
        db.close()

@app.route('/api/friend-requests/<int:request_id>', methods=['PATCH'])
@login_required
def respond_friend_request_route(request_id):
    """回應朋友申請"""
    db = get_db()
    try:
        user_id = session['user_id']
        data = request.json
        action = data.get('action')
        
        if action not in ['accepted', 'declined']:
            return jsonify({'error': 'Invalid action'}), 400
        
        try:
            updated_request, friendship = respond_friend_request(db, request_id, action)
        except ValueError as e:
            return jsonify({'error': str(e)}), 404
        except PermissionError as e:
            return jsonify({'error': str(e)}), 403
        
        # 通知對方（如果在線）
        if action == 'accepted' and updated_request.from_user_id in online_users:
            current_user = get_user_by_id(db, user_id)
            socketio.emit('friend_request:accepted', {
                'user': {
                    'id': current_user.id,
                    'display_name': current_user.display_name,
                    'avatar_url': current_user.avatar_url
                }
            }, room=online_users[updated_request.from_user_id])
        
        return jsonify({
            'request': {
                'id': updated_request.id,
                'from_user_id': updated_request.from_user_id,
                'to_user_id': updated_request.to_user_id,
                'status': updated_request.status.value,
                'created_at': updated_request.created_at.isoformat(),
                'acted_at': updated_request.acted_at.isoformat() if updated_request.acted_at else None
            }
        })
    finally:
        db.close()

@app.route('/api/conversations', methods=['GET'])
@login_required
def get_conversations_route():
    """獲取會話列表"""
    db = get_db()
    try:
        user_id = session['user_id']
        conversations = get_conversations(db, user_id)
        
        conv_list = []
        for conv, other_user, last_message in conversations:
            conv_data = {
                'id': conv.id,
                'type': conv.type.value,
                'other_user': {
                    'id': other_user.id,
                    'display_name': other_user.display_name,
                    'avatar_url': other_user.avatar_url,
                    'is_online': other_user.id in online_users
                },
                'last_message': None,
                'unread_count': get_unread_count(db, conv.id, user_id)
            }
            
            if last_message:
                conv_data['last_message'] = {
                    'id': last_message.id,
                    'content': last_message.content,
                    'sender_id': last_message.sender_id,
                    'created_at': last_message.created_at.isoformat()
                }
            
            conv_list.append(conv_data)
        
        return jsonify({'conversations': conv_list})
    finally:
        db.close()

@app.route('/api/conversations/<int:conversation_id>/messages', methods=['GET'])
@login_required
def get_messages_route(conversation_id):
    """獲取會話訊息"""
    db = get_db()
    try:
        user_id = session['user_id']
        
        # 檢查用戶是否在會話中
        from app.models import ConversationParticipant
        participant = db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == user_id
        ).first()
        
        if not participant:
            return jsonify({'error': 'Conversation not found'}), 404
        
        messages = list_messages(db, conversation_id)
        
        enriched_messages = [{
            'id': msg.id,
            'conversation_id': msg.conversation_id,
            'sender_id': msg.sender_id,
            'content': msg.content,
            'content_type': msg.content_type.value,
            'created_at': msg.created_at.isoformat(),
            'sender': {
                'id': msg.sender.id,
                'display_name': msg.sender.display_name,
                'avatar_url': msg.sender.avatar_url
            }
        } for msg in messages]
        
        return jsonify({'messages': enriched_messages})
    finally:
        db.close()

@socketio.on('connect')
def handle_connect():
    """客戶端連接"""
    print(f'Client connected: {request.sid}')
    emit('connected', {'message': 'Connected to server'})

@socketio.on('authenticate')
def handle_authenticate(data):
    """WebSocket 認證"""
    user_id = session.get('user_id')
    if not user_id:
        emit('error', {'message': 'Not authenticated'})
        return
    
    db = get_db()
    try:
        user = get_user_by_id(db, user_id)
        if not user:
            emit('error', {'message': 'Session expired. Please login again.'})
            return
        
        # 記錄在線狀態
        socket_id = request.sid
        user_sockets[socket_id] = user_id
        online_users[user_id] = socket_id
        
        # 更新最後上線時間
        user.last_seen_at = datetime.now(timezone.utc)
        db.commit()
        
        # 通知朋友用戶上線
        friends = get_friends(db, user_id)
        for friend in friends:
            if friend.id in online_users:
                socketio.emit('user:online', {
                    'user_id': user_id,
                    'user': {
                        'id': user.id,
                        'display_name': user.display_name,
                        'avatar_url': user.avatar_url
                    }
                }, room=online_users[friend.id])
        
        emit('authenticated', {
            'user': {
                'id': user.id,
                'display_name': user.display_name,
                'avatar_url': user.avatar_url,
                'email': user.email
            }
        })
        
        print(f'User {user_id} authenticated on socket {socket_id}')
    finally:
        db.close()

@socketio.on('disconnect')
def handle_disconnect():
    """客戶端斷開連接"""
    socket_id = request.sid
    user_id = user_sockets.pop(socket_id, None)
    
    if user_id:
        online_users.pop(user_id, None)
        
        db = get_db()
        try:
            user = get_user_by_id(db, user_id)
            if user:
                user.last_seen_at = datetime.now(timezone.utc)
                db.commit()
                
                # 通知朋友用戶離線
                friends = get_friends(db, user_id)
                for friend in friends:
                    if friend.id in online_users:
                        socketio.emit('user:offline', {
                            'user_id': user_id,
                            'last_seen': user.last_seen_at.isoformat()
                        }, room=online_users[friend.id])
            
            print(f'User {user_id} disconnected')
        finally:
            db.close()

@socketio.on('message:send')
@socket_login_required
def handle_send_message(data):
    """發送訊息"""
    socket_id = request.sid
    sender_id = user_sockets[socket_id]
    recipient_id = data.get('recipient_id')
    content = data.get('content', '').strip()
    
    if not content:
        emit('error', {'message': 'Message content cannot be empty'})
        return
    
    db = get_db()
    try:
        # 檢查是否為朋友
        if not are_friends(db, sender_id, recipient_id):
            emit('error', {'message': 'You can only message friends'})
            return
        
        # 獲取或建立會話
        try:
            conversation = get_or_create_direct_conversation(db, sender_id, recipient_id)
        except ValueError as e:
            emit('error', {'message': str(e)})
            return
        
        # 儲存訊息
        new_message = save_message(db, conversation.id, sender_id, content)
        
        # 獲取發送者資訊
        sender = get_user_by_id(db, sender_id)
        
        enriched_message = {
            'id': new_message.id,
            'conversation_id': new_message.conversation_id,
            'sender_id': new_message.sender_id,
            'content': new_message.content,
            'created_at': new_message.created_at.isoformat(),
            'sender': {
                'id': sender.id,
                'display_name': sender.display_name,
                'avatar_url': sender.avatar_url
            }
        }
        
        # 發送給自己
        emit('message:new', enriched_message)
        
        # 發送給對方（如果在線）
        if recipient_id in online_users:
            socketio.emit('message:new', enriched_message, room=online_users[recipient_id])
        
        print(f'Message sent: {sender_id} -> {recipient_id}: {content}')
    finally:
        db.close()

@socketio.on('chatroom:send')
@socket_login_required
def handle_chatroom_message(data):
    """發送聊天室訊息（廣播）"""
    socket_id = request.sid
    sender_id = user_sockets[socket_id]
    content = data.get('content', '').strip()
    
    if not content:
        emit('error', {'message': 'Message content cannot be empty'})
        return
    
    db = get_db()
    try:
        sender = get_user_by_id(db, sender_id)
        
        message_data = {
            'id': int(time.time() * 1000),  # simple id using timestamp
            'sender': {
                'id': sender.id,
                'display_name': sender.display_name,
                'avatar_url': sender.avatar_url
            },
            'content': content,
            'created_at': datetime.now(timezone.utc).isoformat()
        }
        
        # 廣播給所有在線用戶
        socketio.emit('chatroom:message', message_data)
        
        print(f'Chatroom message: {sender.display_name}: {content}')
    finally:
        db.close()

@socketio.on('typing:start')
@socket_login_required
def handle_typing_start(data):
    """開始輸入"""
    socket_id = request.sid
    user_id = user_sockets[socket_id]
    recipient_id = data.get('recipient_id')
    
    if recipient_id in online_users:
        db = get_db()
        try:
            user = get_user_by_id(db, user_id)
            socketio.emit('typing:start', {
                'user_id': user_id,
                'user': {
                    'id': user.id,
                    'display_name': user.display_name,
                    'avatar_url': user.avatar_url
                }
            }, room=online_users[recipient_id])
        finally:
            db.close()

@socketio.on('typing:stop')
@socket_login_required
def handle_typing_stop(data):
    """停止輸入"""
    socket_id = request.sid
    user_id = user_sockets[socket_id]
    recipient_id = data.get('recipient_id')
    
    if recipient_id in online_users:
        socketio.emit('typing:stop', {'user_id': user_id}, room=online_users[recipient_id])

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    host = os.getenv('HOST', '127.0.0.1')
    debug = os.getenv('FLASK_DEBUG', '1') == '1'
    
    print(f'Starting server on {host}:{port}')
    print(f'Auth mode: {os.getenv("AUTH_MODE", "mock")}')
    print(f'Database: {os.getenv("DATABASE_URL", "sqlite:///chatroom_dev.db")}')
    
    socketio.run(app, host=host, port=port, debug=debug)