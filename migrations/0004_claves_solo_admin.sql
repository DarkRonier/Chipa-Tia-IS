-- Solo el administrador cambia contraseñas: a los operadores ya no se les pide que elijan la suya al entrar.
UPDATE usuarios SET debe_cambiar_clave = 0 WHERE rol <> 'admin';
