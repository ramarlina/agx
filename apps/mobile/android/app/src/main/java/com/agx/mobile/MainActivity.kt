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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = HostStore(applicationContext)
        setContent {
            MaterialTheme {
                AppNav(store)
            }
        }
    }
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
        topBar = { TopAppBar(title = { Text("agx") }) },
        floatingActionButton = {
            FloatingActionButton(onClick = onAdd) { Icon(Icons.Default.Add, "Add host") }
        },
    ) { padding ->
        if (sorted.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No hosts yet", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    FilledTonalButton(onClick = onAdd) { Text("+ Add your first agx") }
                }
            }
        } else {
            LazyColumn(Modifier.padding(padding)) {
                items(sorted, key = { it.id }) { host ->
                    HostRow(
                        host = host,
                        onClick = { onOpen(host) },
                        onEdit = { onEdit(host) },
                        onDelete = { scope.launch { store.delete(host.id) } },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
fun HostRow(host: Host, onClick: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = { Text(host.name, fontWeight = FontWeight.Medium) },
        supportingContent = {
            Column {
                Text(host.url, style = MaterialTheme.typography.bodySmall)
                Text(lastUsedLabel(host.lastUsed), style = MaterialTheme.typography.labelSmall)
            }
        },
        trailingContent = {
            Row {
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, "Edit") }
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, "Delete") }
            }
        },
    )
}

private fun lastUsedLabel(ts: Long): String =
    if (ts == 0L) "never used" else "last used " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(ts))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostEdit(store: HostStore, id: String, onDone: () -> Unit) {
    val hosts by store.hosts.collectAsStateWithLifecycle(initialValue = emptyList())
    val existing = remember(hosts, id) { hosts.firstOrNull { it.id == id } }
    var name by remember(existing) { mutableStateOf(existing?.name ?: "") }
    var url by remember(existing) { mutableStateOf(existing?.url ?: "https://") }
    val scope = rememberCoroutineScope()
    val canSave = name.isNotBlank() && url.startsWith("http")

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (existing == null) "Add connection" else "Edit connection") },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.Default.ArrowBack, "Back") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            OutlinedTextField(
                value = name, onValueChange = { name = it },
                label = { Text("Name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = url, onValueChange = { url = it.trim() },
                label = { Text("URL") }, singleLine = true,
                placeholder = { Text("https://machine.tail-xxxx.ts.net") },
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
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebHost(store: HostStore, id: String, onBack: () -> Unit) {
    val hosts by store.hosts.collectAsStateWithLifecycle(initialValue = emptyList())
    val host = hosts.firstOrNull { it.id == id }
    val scope = rememberCoroutineScope()
    var webView by remember { mutableStateOf<WebView?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) { store.touch(id) }
    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }

    if (host == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(host.name) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                },
                actions = {
                    IconButton(onClick = { error = null; webView?.reload() }) {
                        Icon(Icons.Default.Refresh, "Reload")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
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
                    modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Row(
                        Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(msg, Modifier.weight(1f))
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
