const { connectionString } = require('../Conexion/Conexion');
const path = require('path');
const Swal = require('sweetalert2');

// Función para verificar credenciales
async function verificarCredenciales(usuario, password) {
    try {
        const connection = await connectionString();
        const result = await connection.query(
            `SELECT
                usuarios.Id, 
                usuarios.NombreCompleto,
                usuarios.Usuario, 
                usuarios.Password
            FROM
                usuarios
            WHERE
                usuarios.Activo = 1 AND
                usuarios.Entrada = 1 AND
                usuarios.Usuario = ?`,
            [usuario]
        );
        await connection.close();
        
        if (result.length > 0) {
            return result[0];
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error de conexión o consulta:', error);
        throw error;
    }
}

// Función para mostrar modal de carga
function mostrarCargando(mensaje = "Verificando credenciales...") {
    return Swal.fire({
        title: mensaje,
        html: `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
                <div class="spinner" style="
                    border: 4px solid rgba(37, 99, 235, 0.1);
                    border-top: 4px solid #2563eb;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                "></div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `,
        showConfirmButton: false,
        allowOutsideClick: false,
        background: '#1a1d23',
        color: '#ffffff'
    });
}

// Toggle para mostrar/ocultar contraseña
document.getElementById('togglePassword').addEventListener('click', function() {
    const passwordInput = document.getElementById('password');
    const icon = this.querySelector('i');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});

// Validación en tiempo real
document.getElementById('usuario').addEventListener('input', function() {
    this.value = this.value.trim();
});

document.getElementById('password').addEventListener('input', function() {
    // Opcional: validaciones adicionales
});

// Manejo del formulario de login
document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;
    
    // Validaciones básicas
    if (!usuario || !password) {
        await Swal.fire({
            icon: 'warning',
            title: 'Campos incompletos',
            text: 'Por favor ingresa usuario y contraseña',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#2563eb',
            background: '#1a1d23',
            color: '#ffffff'
        });
        return;
    }
    
    // Agregar clase de carga
    document.querySelector('.login-box').classList.add('submitting');
    const loadingSwal = mostrarCargando('Verificando credenciales...');
    
    try {
        const userData = await verificarCredenciales(usuario, password);
        loadingSwal.close();
        
        if (userData) {
            // Verificar contraseña (aquí deberías usar hash, por simplicidad usamos comparación directa)
            if (userData.Password === password) {
                document.querySelector('.login-box').classList.remove('submitting');
                document.querySelector('.login-box').classList.add('success');
                
                // Guardar datos del usuario en localStorage
                const userInfo = {
                    id: userData.Id,
                    nombre: userData.NombreCompleto,
                    usuario: userData.Usuario
                };
                localStorage.setItem('userData', JSON.stringify(userInfo));
                
                // Mostrar mensaje de éxito
                await Swal.fire({
                    icon: 'success',
                    title: '¡Bienvenido!',
                    html: `
                        <div style="text-align: center;">
                            <h3 style="margin: 15px 0; color: #ffffff; font-size: 1.3rem;">${userData.NombreCompleto}</h3>
                            <p style="color: #9ca3af; margin-top: 10px;">Accediendo al sistema WMS...</p>
                        </div>
                    `,
                    timer: 2000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    background: '#1a1d23',
                    color: '#ffffff'
                });
                
                // Redirigir a Home
                window.location.href = path.join(__dirname, '../Vistas/Home.html');
                
            } else {
                // Contraseña incorrecta
                document.querySelector('.login-box').classList.remove('submitting');
                document.querySelector('.login-box').classList.add('error');
                
                await Swal.fire({
                    icon: 'error',
                    title: 'Contraseña incorrecta',
                    text: 'La contraseña ingresada no es válida',
                    confirmButtonText: 'Intentar de nuevo',
                    confirmButtonColor: '#dc2626',
                    background: '#1a1d23',
                    color: '#ffffff'
                });
                
                setTimeout(() => {
                    document.querySelector('.login-box').classList.remove('error');
                    document.getElementById('password').value = '';
                    document.getElementById('password').focus();
                }, 1000);
            }
        } else {
            // Usuario no encontrado
            document.querySelector('.login-box').classList.remove('submitting');
            document.querySelector('.login-box').classList.add('error');
            
            await Swal.fire({
                icon: 'error',
                title: 'Usuario no encontrado',
                text: 'El usuario ingresado no existe o no tiene permisos de acceso',
                confirmButtonText: 'Aceptar',
                confirmButtonColor: '#dc2626',
                background: '#1a1d23',
                color: '#ffffff'
            });
            
            setTimeout(() => {
                document.querySelector('.login-box').classList.remove('error');
                document.getElementById('usuario').value = '';
                document.getElementById('password').value = '';
                document.getElementById('usuario').focus();
            }, 1000);
        }
    } catch (error) {
        loadingSwal.close();
        document.querySelector('.login-box').classList.remove('submitting');
        document.querySelector('.login-box').classList.add('error');
        
        await Swal.fire({
            icon: 'error',
            title: 'Error de Conexión',
            text: 'No se pudo conectar con la base de datos. Verifica tu conexión.',
            confirmButtonText: 'Aceptar',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        setTimeout(() => {
            document.querySelector('.login-box').classList.remove('error');
        }, 1000);
    }
});

// Focus automático al cargar
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('usuario').focus();
});