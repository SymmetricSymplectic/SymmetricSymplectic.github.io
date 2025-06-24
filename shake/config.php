<?php
// config.php - Configuración centralizada de la base de datos

// Configuración para conexión remota
$config = [
    'database' => [
        'host' => '146.190.57.35',
        'port' => 3306,
        'dbname' => 'ShakeDB',
        'username' => 'shakeapp',
        'password' => 'J24_9xQRBzz8-DW',  
        'charset' => 'utf8mb4',
        'timeout' => 30,  // Timeout de conexión para conexiones remotas
        'options' => [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 30,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
            PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT => false  // Para conexiones SSL remotas
        ]
    ]
];

// Función para obtener conexión PDO con configuración remota
function getDatabase() {
    global $config;
    
    $dsn = sprintf(
        "mysql:host=%s;port=%d;dbname=%s;charset=%s",
        $config['database']['host'],
        $config['database']['port'],
        $config['database']['dbname'],
        $config['database']['charset']
    );
    
    try {
        // Crear conexión PDO con timeout extendido para conexiones remotas
        $pdo = new PDO(
            $dsn,
            $config['database']['username'],
            $config['database']['password'],
            $config['database']['options']
        );
        
        // Configuraciones adicionales para conexiones remotas
        $pdo->exec("SET SESSION wait_timeout=300");
        $pdo->exec("SET SESSION interactive_timeout=300");
        
        return $pdo;
        
    } catch (PDOException $e) {
        $errorMessage = "Error de conexión remota: " . $e->getMessage();
        error_log($errorMessage);
        
        // Agregar información de diagnóstico
        if (strpos($e->getMessage(), 'Connection refused') !== false) {
            throw new Exception("No se pudo conectar al servidor remoto. Verifica que el host y puerto sean correctos.");
        } elseif (strpos($e->getMessage(), 'Access denied') !== false) {
            throw new Exception("Acceso denegado. Verifica el usuario y contraseña.");
        } elseif (strpos($e->getMessage(), 'Unknown database') !== false) {
            throw new Exception("Base de datos no encontrada. Verifica el nombre de la BD.");
        } else {
            throw new Exception("Error de conexión remota: " . $e->getMessage());
        }
    }
}

// Función para verificar la conexión remota
function testConnection() {
    try {
        $pdo = getDatabase();
        
        // Test básico de conexión
        $stmt = $pdo->query("SELECT 1 as test");
        $result = $stmt->fetch();
        
        if ($result && $result['test'] == 1) {
            return [
                'success' => true,
                'message' => 'Conexión remota exitosa',
                'server_info' => $pdo->getAttribute(PDO::ATTR_SERVER_INFO)
            ];
        }
        
        return ['success' => false, 'message' => 'Test de conexión falló'];
        
    } catch (Exception $e) {
        return [
            'success' => false, 
            'message' => $e->getMessage(),
            'error_type' => get_class($e)
        ];
    }
}

// Función para verificar latencia de conexión
function testLatency() {
    $start = microtime(true);
    
    try {
        $result = testConnection();
        $end = microtime(true);
        
        $latency = round(($end - $start) * 1000, 2); // En milisegundos
        
        return [
            'success' => $result['success'],
            'latency_ms' => $latency,
            'message' => $result['message']
        ];
        
    } catch (Exception $e) {
        return [
            'success' => false,
            'latency_ms' => 0,
            'message' => $e->getMessage()
        ];
    }
}
?>