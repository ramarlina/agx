package com.agx.mobile

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.Date
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.BLACK),
        )
        val store = HostStore(applicationContext)
        setContent {
            AgxTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .windowInsetsPadding(WindowInsets.statusBars),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AppNav(store)
                }
            }
        }
    }
}

@Composable
fun AgxTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) {
        darkColorScheme(
            primary = Color(0xFF8AB4F8),
            onPrimary = Color(0xFF0B1B30),
            background = Color(0xFF0F1115),
            surface = Color(0xFF15181F),
            surfaceVariant = Color(0xFF1E232C),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF1A6FE0),
            onPrimary = Color.White,
            background = Color(0xFFF7F8FA),
            surface = Color.White,
            surfaceVariant = Color(0xFFEDF0F5),
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

@Composable
fun AppNav(store: HostStore) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "list") {
        composable("list") {
            HostList(
                store = store,
                onAdd = { nav.navigate("edit/new") },
                onEdit = { nav.navigate("edit/${it.id}") },
                onOpen = { nav.navigate("web/${it.id}") },
            )
        }
        composable("edit/{id}") { backStack ->
            val id = backStack.arguments?.getString("id") ?: "new"
            HostEdit(store = store, id = id, onDone = { nav.popBackStack() })
        }
        composable("web/{id}") { backStack ->
            val id = backStack.arguments?.getString("id") ?: return@composable
            WebHost(store = store, id = id, onBack = { nav.popBackStack() })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostList(
    store: HostStore,
    onAdd: () -> Unit,
    onEdit: (Host) -> Unit,
    onOpen: (Host) -> Unit,
) {
    val hosts by store.hosts.collectAsStateWithLifecycle(initialValue = emptyList())
    val sorted = remember(hosts) { hosts.sortedByDescending { it.lastUsed } }
    val scope = rememberCoroutineScope()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    val logoRes = if (isSystemInDarkTheme()) R.drawable.logo_light else R.drawable.logo_dark
                    Image(
                        painter = painterResource(logoRes),
                        contentDescription = "Agx",
                        modifier = Modifier.height(24.dp),
                    )
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                windowInsets = WindowInsets(0),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onAdd,
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("Add host") },
            )
        },
    ) { padding ->
        if (sorted.isEmpty()) {
            EmptyState(
                modifier = Modifier.fillMaxSize().padding(padding),
                onAdd = onAdd,
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(sorted, key = { it.id }) { host ->
                    HostCard(
                        host = host,
                        onClick = { onOpen(host) },
                        onEdit = { onEdit(host) },
                        onDelete = { scope.launch { store.delete(host.id) } },
                    )
                }
                item { Spacer(Modifier.height(80.dp)) }
            }
        }
    }
}

@Composable
fun EmptyState(modifier: Modifier = Modifier, onAdd: () -> Unit) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Cloud,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(36.dp),
                )
            }
            Text("No hosts yet", style = MaterialTheme.typography.titleMedium)
            Text(
                "Add your first agx connection to get started",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FilledTonalButton(onClick = onAdd) {
                Icon(Icons.Default.Add, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Add host")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostCard(
    host: Host,
    onClick: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Cloud,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    host.name,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    host.url.removePrefix("https://").removePrefix("http://"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    lastUsedLabel(host.lastUsed),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    fontSize = 11.sp,
                )
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Default.MoreVert, "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        leadingIcon = { Icon(Icons.Default.Edit, null) },
                        onClick = { menuOpen = false; onEdit() },
                    )
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        leadingIcon = { Icon(Icons.Default.Delete, null) },
                        onClick = { menuOpen = false; onDelete() },
                    )
                }
            }
        }
    }
}

private fun lastUsedLabel(ts: Long): String {
    if (ts == 0L) return "Never used"
    val diff = System.currentTimeMillis() - ts
    val mins = TimeUnit.MILLISECONDS.toMinutes(diff)
    val hours = TimeUnit.MILLISECONDS.toHours(diff)
    val days = TimeUnit.MILLISECONDS.toDays(diff)
    return when {
        mins < 1 -> "Just now"
        mins < 60 -> "$mins min ago"
        hours < 24 -> "$hours h ago"
        days < 7 -> "$days d ago"
        else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(Date(ts))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostEdit(store: HostStore, id: String, onDone: () -> Unit) {
    val hosts by store.hosts.collectAsStateWithLifecycle(initialValue = emptyList())
    val existing = remember(hosts, id) { hosts.firstOrNull { it.id == id } }
    var name by remember(existing) { mutableStateOf(existing?.name ?: "") }
    var url by remember(existing) { mutableStateOf(existing?.url ?: "https://") }
    val scope = rememberCoroutineScope()
    val canSave = name.isNotBlank() && url.startsWith("http") && url.length > 8

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(if (existing == null) "Add connection" else "Edit connection") },
                navigationIcon = {
                    IconButton(onClick = onDone) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                windowInsets = WindowInsets(0),
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Give it a name and the URL where your agx is running.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name") },
                placeholder = { Text("Home desktop") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = url,
                onValueChange = { url = it.trim() },
                label = { Text("URL") },
                placeholder = { Text("https://machine.tail-xxxx.ts.net") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.weight(1f))
            Button(
                enabled = canSave,
                onClick = {
                    scope.launch {
                        val host = existing?.copy(name = name, url = url)
                            ?: Host(name = name, url = url)
                        store.upsert(host)
                        onDone()
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Save", fontWeight = FontWeight.SemiBold) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebHost(store: HostStore, id: String, onBack: () -> Unit) {
    val hosts by store.hosts.collectAsStateWithLifecycle(initialValue = emptyList())
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        store.hosts.first()
        settled = true
    }
    val host = hosts.firstOrNull { it.id == id }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) { store.touch(id) }

    LaunchedEffect(settled, host) {
        if (settled && host == null) onBack()
    }

    if (host == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }
    BackHandler(enabled = !drawerState.isOpen && webView?.canGoBack() == true) {
        webView?.goBack()
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Spacer(Modifier.height(24.dp))
                Text(
                    host.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                Text(
                    host.url.removePrefix("https://").removePrefix("http://"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                NavigationDrawerItem(
                    label = { Text("Back to hosts") },
                    icon = { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) },
                    selected = false,
                    onClick = {
                        scope.launch { drawerState.close() }
                        onBack()
                    },
                )
                NavigationDrawerItem(
                    label = { Text("Reload") },
                    icon = { Icon(Icons.Default.Refresh, null) },
                    selected = false,
                    onClick = {
                        scope.launch { drawerState.close() }
                        error = null
                        webView?.reload()
                    },
                )
            }
        },
    ) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = true
                        webChromeClient = WebChromeClient()
                        webViewClient = object : WebViewClient() {
                            override fun onReceivedError(
                                view: WebView?,
                                request: android.webkit.WebResourceRequest?,
                                err: android.webkit.WebResourceError?,
                            ) {
                                if (request?.isForMainFrame == true) {
                                    error = "Can't reach host — check Tailscale"
                                }
                            }
                        }
                        loadUrl(host.url)
                        webView = this
                    }
                },
            )

            error?.let { msg ->
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 16.dp, start = 16.dp, end = 16.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium,
                    shadowElevation = 4.dp,
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(msg, Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer)
                        TextButton(onClick = {
                            error = null
                            webView?.loadUrl(host.url)
                        }) { Text("Retry") }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FloatingIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .size(40.dp)
            .shadow(4.dp, CircleShape),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
